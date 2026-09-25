/**
 * The GPU VTEC API. Build plan section 3.
 *
 *   bun services/api/src/server.ts
 *
 * Routes, and what each one refuses:
 *
 *   POST /projects                 register a project, mirror it onchain
 *   POST /jobs                     enqueue a run; idempotent on a client key
 *   GET  /jobs/:id/events          SSE, replays the append-only log then follows
 *   POST /jobs/:id/events          the evaluator appends progress
 *   GET  /candidates/:id           immutable metadata and evidence links
 *   POST /candidates               the evaluator registers what it built
 *   POST /reports                  the evaluator posts a SIGNED report
 *   POST /releases/propose         build one exact action; refuses a non-accepted report
 *   POST /releases/:id/consent     the operator agrees in-app, having seen it
 *   POST /auth/world/start         begin the identity journey
 *   GET  /auth/world/callback      validate the response, bind it to the proposal
 *   POST /releases/:id/submit      relay, with owner + bridge signatures
 *   GET  /releases/:id             proposal state plus what the chain says
 *   GET  /projects/:id/release     what a consumer would read
 *
 * The API holds no authority. It cannot sign a report (the evaluator's key), it
 * cannot issue a permit (the bridge's key), and it cannot approve a release (the
 * owner's wallet). It can only pay gas, and only if a relayer key is configured.
 */

import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import { isAddress, type Hex } from "viem";
import {
  computeCandidateId,
  environmentScopeHash,
  type HardwareScope,
  computeReportHash,
  labelHash,
  promotionDigest,
  VERDICT_CODE,
  type Verdict,
} from "../../../packages/schemas/src/index";
import { loadConfig, publicConfig, type ApiConfig } from "./config";
import { appendEvent, eventsSince, openDatabase } from "./db";
import {
  publicClientFor,
  readCurrentRelease,
  REGISTRY_ABI,
  walletClientFor,
  writeAndConfirm,
} from "./chain";

const ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

/* -------------------------------------------------------------------------- */
/* Plumbing                                                                    */
/* -------------------------------------------------------------------------- */

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
  }
}

const bad = (code: string, message: string, detail?: unknown) =>
  new HttpError(400, code, message, detail);
const notFound = (what: string) => new HttpError(404, "not_found", `${what} not found`);

function json(body: unknown, status = 200, origin = "*") {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": origin,
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    },
  });
}

function requireHex32(value: unknown, field: string): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw bad("invalid_field", `${field} must be a 0x-prefixed 32-byte hex string`);
  }
  return value as Hex;
}

function requireAddress(value: unknown, field: string): Hex {
  if (typeof value !== "string" || !isAddress(value)) {
    throw bad("invalid_field", `${field} must be an address`);
  }
  return value as Hex;
}

function requireString(value: unknown, field: string, max = 512): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw bad("invalid_field", `${field} must be a string of 1..${max} characters`);
  }
  return value;
}

function requireInt(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw bad("invalid_field", `${field} must be an integer in ${min}..${max}`);
  }
  return value;
}

/* -------------------------------------------------------------------------- */
/* Handlers                                                                    */
/* -------------------------------------------------------------------------- */

export function createApi(config: ApiConfig, db: Database) {
  const chain = {
    rpcUrl: config.rpcUrl,
    chainId: config.chainId,
    registry: config.registry,
    relayerKey: config.relayerKey,
  };
  const publicClient = publicClientFor(chain);
  const wallet = walletClientFor(chain);

  /** Live SSE subscribers, per job. */
  const listeners = new Map<string, Set<(event: unknown) => void>>();

  function broadcast(jobId: string, event: unknown) {
    for (const send of listeners.get(jobId) ?? []) send(event);
  }

  function project(projectId: string) {
    const row = db
      .query("SELECT * FROM projects WHERE project_id = ?")
      .get(projectId) as Record<string, never> | null;
    if (!row) throw notFound("project");
    return row as unknown as {
      project_id: string;
      name: string;
      owner: Hex;
      evaluator_signer: Hex;
      bridge_signer: Hex;
      policy_hash: Hex;
      config_version: number;
      chain_id: number;
      registry_address: Hex;
    };
  }

  /* ---------------------------------------------------------------------- */

  const routes: Record<string, (req: Request, params: string[]) => Promise<Response>> = {};

  const route = (
    method: string,
    pattern: RegExp,
    handler: (req: Request, params: string[], body: never) => Promise<unknown>,
  ) => {
    routes[`${method} ${pattern.source}`] = async (req, params) => {
      // An empty body is legitimate: /consent and /submit-style routes carry
      // their meaning in the URL. Only a body that is present and malformed is
      // an error, so read the text first rather than letting json() throw on "".
      let body: unknown = {};
      if (method === "POST") {
        const text = await req.text();
        if (text.trim().length > 0) {
          try {
            body = JSON.parse(text);
          } catch {
            throw bad("invalid_json", "body is not valid JSON");
          }
        }
      }
      return json(await handler(req, params, body as never), method === "POST" ? 201 : 200);
    };
    return { method, pattern, key: `${method} ${pattern.source}` };
  };

  const table = [
    /* ---- health and config ------------------------------------------- */
    route("GET", /^\/health$/, async () => ({
      ok: true,
      ...publicConfig(config),
      note: "The API holds no signing authority. See services/README.md.",
    })),

    /* ---- projects ------------------------------------------------------ */
    route("POST", /^\/projects$/, async (_req, _p, body: Record<string, unknown>) => {
      const name = requireString(body.name, "name", 120);
      const owner = requireAddress(body.owner, "owner");
      const evaluatorSigner = requireAddress(body.evaluatorSigner, "evaluatorSigner");
      const bridgeSigner = requireAddress(body.bridgeSigner, "bridgeSigner");
      const policyLabel = requireString(body.policyLabel, "policyLabel", 200);

      const projectId = labelHash(name);
      const policyHash = labelHash(policyLabel);

      const existing = db.query("SELECT 1 FROM projects WHERE project_id = ?").get(projectId);
      if (existing) throw bad("project_exists", "a project with that name already exists");

      db.query(
        `INSERT INTO projects
           (project_id, name, owner, evaluator_signer, bridge_signer, policy_hash,
            config_version, chain_id, registry_address, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      ).run(
        projectId,
        name,
        owner,
        evaluatorSigner,
        bridgeSigner,
        policyHash,
        config.chainId,
        config.registry,
        new Date().toISOString(),
      );

      let tx: string | null = null;
      if (wallet) {
        tx = await writeAndConfirm(publicClient, wallet, {
          address: config.registry,
          functionName: "createProject",
          args: [projectId, owner, evaluatorSigner, bridgeSigner, policyHash],
        });
      }

      return { projectId, policyHash, name, tx };
    }),

    route("GET", /^\/projects\/(0x[0-9a-fA-F]{64})$/, async (_req, [projectId]) =>
      project(projectId),
    ),

    /* ---- jobs ---------------------------------------------------------- */
    route("POST", /^\/jobs$/, async (_req, _p, body: Record<string, unknown>) => {
      const projectId = requireHex32(body.projectId, "projectId");
      project(projectId);
      const workloadId = requireString(body.workloadId, "workloadId", 200);

      // Section 5's budget: five candidates or 20 minutes, whichever comes first.
      const budgetCandidates = requireInt(body.budgetCandidates ?? 5, "budgetCandidates", 1, 50);
      const budgetSeconds = requireInt(body.budgetSeconds ?? 1200, "budgetSeconds", 30, 7200);

      const idempotencyKey =
        typeof body.idempotencyKey === "string" ? body.idempotencyKey : null;

      if (idempotencyKey) {
        const prior = db
          .query("SELECT job_id FROM jobs WHERE idempotency_key = ?")
          .get(idempotencyKey) as { job_id: string } | null;
        // Section 3: a restarted service must never silently repeat work.
        if (prior) return { jobId: prior.job_id, deduplicated: true };
      }

      const jobId = randomUUID();
      db.query(
        `INSERT INTO jobs
           (job_id, project_id, workload_id, status, budget_candidates, budget_seconds,
            idempotency_key, created_at)
         VALUES (?, ?, ?, 'queued', ?, ?, ?, ?)`,
      ).run(
        jobId,
        projectId,
        workloadId,
        budgetCandidates,
        budgetSeconds,
        idempotencyKey,
        new Date().toISOString(),
      );

      const event = appendEvent(db, jobId, {
        type: "job",
        status: "queued",
        detail: `queued ${workloadId}, budget ${budgetCandidates} candidates / ${budgetSeconds}s`,
      });
      broadcast(jobId, event);

      return { jobId, deduplicated: false };
    }),

    route("POST", /^\/jobs\/([0-9a-f-]{36})\/events$/, async (_req, [jobId], body) => {
      const job = db.query("SELECT job_id FROM jobs WHERE job_id = ?").get(jobId);
      if (!job) throw notFound("job");

      const event = appendEvent(db, jobId, body);
      broadcast(jobId, event);

      const payload = body as { type?: string; status?: string };
      if (payload.type === "job" && typeof payload.status === "string") {
        db.query("UPDATE jobs SET status = ? WHERE job_id = ?").run(payload.status, jobId);
      }
      return { seq: event.seq };
    }),

    /* ---- candidates ---------------------------------------------------- */
    route("POST", /^\/candidates$/, async (_req, _p, body: Record<string, unknown>) => {
      const projectId = requireHex32(body.projectId, "projectId");
      const row = project(projectId);

      const parentId = body.parentId === undefined ? ZERO : requireHex32(body.parentId, "parentId");
      const workloadHash = requireHex32(body.workloadHash, "workloadHash");
      const envScopeHash = requireHex32(body.environmentScopeHash, "environmentScopeHash");
      const sourceDigest = requireHex32(body.sourceDigest, "sourceDigest");
      const binaryDigest = requireHex32(body.binaryDigest, "binaryDigest");
      const manifestHash = requireHex32(body.manifestHash, "manifestHash");
      const hypothesis = requireString(body.hypothesis, "hypothesis", 2000);
      const hypothesisHash = labelHash(hypothesis);

      // Optional, but strongly wanted: the readable scope behind the hash. When
      // it is supplied the API checks it actually hashes to what was claimed,
      // because a scope that disagrees with its own hash is worse than none.
      const scope = body.environmentScope as HardwareScope | undefined;
      if (scope !== undefined) {
        const derived = environmentScopeHash(scope);
        if (derived.toLowerCase() !== envScopeHash.toLowerCase()) {
          throw bad(
            "scope_mismatch",
            `environmentScope hashes to ${derived}, but environmentScopeHash says ${envScopeHash}`,
          );
        }
      }

      // Derived, never accepted from the caller. If the client and the contract
      // disagree about an id, that is milestone M5's problem, not a value to
      // trust over the wire.
      const candidateId = computeCandidateId({
        parentId,
        workloadHash,
        environmentScopeHash: envScopeHash,
        sourceDigest,
        binaryDigest,
        hypothesisHash,
      });

      const existing = db
        .query("SELECT candidate_id, project_id FROM candidates WHERE candidate_id = ?")
        .get(candidateId) as { candidate_id: string; project_id: string } | null;

      if (existing) {
        // Section 7's candidateId formula deliberately omits the project, so ids
        // are global. Identical candidate content in two projects collides, and
        // the contract's registerCandidate would revert with CandidateExists
        // while promoteRelease would later fail with UnknownCandidate three
        // steps downstream. Say so here instead, where it is actionable.
        if (existing.project_id !== projectId) {
          throw bad(
            "candidate_belongs_to_another_project",
            `candidate ${candidateId} is already registered under project ` +
              `${existing.project_id}. Candidate ids do not include the project ` +
              "(build plan section 7), so identical source, binary, workload, " +
              "environment scope and hypothesis produce the same id everywhere. " +
              "Change one of those, or reuse the original project.",
            { candidateId, registeredUnder: existing.project_id },
          );
        }
        return { candidateId, deduplicated: true };
      }

      db.query(
        `INSERT INTO candidates
           (candidate_id, project_id, parent_id, workload_hash, env_scope_hash,
            source_digest, binary_digest, hypothesis_hash, manifest_hash, hypothesis,
            env_scope, job_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        candidateId,
        projectId,
        parentId,
        workloadHash,
        envScopeHash,
        sourceDigest,
        binaryDigest,
        hypothesisHash,
        manifestHash,
        hypothesis,
        scope ? JSON.stringify(scope) : null,
        typeof body.jobId === "string" ? body.jobId : null,
        new Date().toISOString(),
      );

      let tx: string | null = null;
      if (wallet && row.owner.toLowerCase() === wallet.account!.address.toLowerCase()) {
        tx = await writeAndConfirm(publicClient, wallet, {
          address: config.registry,
          functionName: "registerCandidate",
          args: [
            projectId,
            parentId,
            workloadHash,
            envScopeHash,
            sourceDigest,
            binaryDigest,
            hypothesisHash,
            manifestHash,
          ],
        });
        db.query("UPDATE candidates SET onchain_tx = ? WHERE candidate_id = ?").run(
          tx,
          candidateId,
        );
      }

      return { candidateId, hypothesisHash, tx, deduplicated: false };
    }),

    route("GET", /^\/candidates\/(0x[0-9a-fA-F]{64})$/, async (_req, [candidateId]) => {
      const row = db
        .query("SELECT * FROM candidates WHERE candidate_id = ?")
        .get(candidateId);
      if (!row) throw notFound("candidate");
      const reports = db
        .query(
          "SELECT report_hash, verdict, observed_at, onchain_tx FROM reports WHERE candidate_id = ? ORDER BY observed_at",
        )
        .all(candidateId);
      return { ...(row as object), reports };
    }),

    route("GET", /^\/candidates\/(0x[0-9a-fA-F]{64})\/scope$/, async (_req, [candidateId]) => {
      const row = db
        .query("SELECT env_scope FROM candidates WHERE candidate_id = ?")
        .get(candidateId) as { env_scope: string | null } | null;
      if (!row) throw notFound("candidate");
      if (!row.env_scope) {
        throw new HttpError(
          404,
          "scope_not_recorded",
          "this candidate was registered without a readable hardware scope",
        );
      }
      return JSON.parse(row.env_scope);
    }),

    /* ---- reports ------------------------------------------------------- */
    route("POST", /^\/reports$/, async (_req, _p, body: Record<string, unknown>) => {
      const candidateId = requireHex32(body.candidateId, "candidateId");
      const candidate = db
        .query("SELECT project_id FROM candidates WHERE candidate_id = ?")
        .get(candidateId) as { project_id: string } | null;
      if (!candidate) throw notFound("candidate");
      const row = project(candidate.project_id);

      const verdict = requireString(body.verdict, "verdict", 20) as Verdict;
      if (!(verdict in VERDICT_CODE) || verdict === "none") {
        throw bad("invalid_verdict", "verdict must be accepted, rejected or inconclusive");
      }

      const report = {
        candidateId,
        policyHash: requireHex32(body.policyHash, "policyHash"),
        rawSamplesDigest: requireHex32(body.rawSamplesDigest, "rawSamplesDigest"),
        environmentDigest: requireHex32(body.environmentDigest, "environmentDigest"),
        verdict,
        observedAt: BigInt(requireInt(body.observedAt, "observedAt", 0, 2 ** 53 - 1)),
      };
      const reportHash = computeReportHash(report);

      // The signature is the evaluator's, and only the evaluator can make it.
      // The API stores it and relays it; the contract is what actually checks it.
      const signature =
        typeof body.signature === "string" && /^0x[0-9a-fA-F]+$/.test(body.signature)
          ? (body.signature as Hex)
          : null;

      const existing = db.query("SELECT 1 FROM reports WHERE report_hash = ?").get(reportHash);
      if (existing) return { reportHash, deduplicated: true };

      db.query(
        `INSERT INTO reports
           (report_hash, candidate_id, policy_hash, raw_samples_digest, environment_digest,
            verdict, observed_at, evaluator, signature, body, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        reportHash,
        candidateId,
        report.policyHash,
        report.rawSamplesDigest,
        report.environmentDigest,
        verdict,
        Number(report.observedAt),
        row.evaluator_signer,
        signature,
        JSON.stringify(body.detail ?? {}),
        new Date().toISOString(),
      );

      let tx: string | null = null;
      if (wallet && signature) {
        tx = await writeAndConfirm(publicClient, wallet, {
          address: config.registry,
          functionName: "recordReport",
          args: [
            {
              candidateId,
              policyHash: report.policyHash,
              rawSamplesDigest: report.rawSamplesDigest,
              environmentDigest: report.environmentDigest,
              verdict: VERDICT_CODE[verdict],
              observedAt: report.observedAt,
            },
            signature,
          ],
        });
        db.query("UPDATE reports SET onchain_tx = ? WHERE report_hash = ?").run(tx, reportHash);
      }

      return { reportHash, tx, signed: signature !== null, deduplicated: false };
    }),

    /* ---- releases ------------------------------------------------------ */
    route("POST", /^\/releases\/propose$/, async (_req, _p, body: Record<string, unknown>) => {
      const projectId = requireHex32(body.projectId, "projectId");
      const row = project(projectId);
      const channel = requireString(body.channel ?? "stable", "channel", 60);
      const reportHash = requireHex32(body.reportHash, "reportHash");

      const report = db.query("SELECT * FROM reports WHERE report_hash = ?").get(reportHash) as
        | { candidate_id: string; verdict: string; policy_hash: string }
        | null;
      if (!report) throw notFound("report");

      // Section 8: only an accepted report can be promoted. This is checked here
      // so the operator is never shown a consent screen for something the chain
      // would refuse, and again by the contract because this check is advisory.
      if (report.verdict !== "accepted") {
        throw bad(
          "report_not_accepted",
          `report verdict is "${report.verdict}" - only an accepted report can be promoted`,
        );
      }
      if (report.policy_hash !== row.policy_hash) {
        throw bad("policy_mismatch", "the report was measured under a different policy");
      }

      const channelHash = labelHash(channel);
      const current = await readCurrentRelease(
        publicClient,
        config.registry,
        projectId,
        channelHash,
      );

      // Section 9: expiry is short. Five minutes is the plan's proposal.
      const deadline = Math.floor(Date.now() / 1000) + 300;
      const nonce = BigInt(`0x${randomUUID().replace(/-/g, "")}`) % 2n ** 64n;

      const action = {
        projectId,
        configVersion: BigInt(row.config_version),
        owner: row.owner,
        channelHash,
        candidateId: report.candidate_id as Hex,
        reportHash,
        policyHash: row.policy_hash,
        expectedPreviousReleaseId: current.releaseId,
        nonce,
        deadline: BigInt(deadline),
      };
      const digest = promotionDigest(action, BigInt(config.chainId), config.registry);

      const proposalId = randomUUID();
      db.query(
        `INSERT INTO proposals
           (proposal_id, project_id, channel, channel_hash, candidate_id, report_hash,
            policy_hash, expected_previous, nonce, deadline, owner, config_version,
            digest, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      ).run(
        proposalId,
        projectId,
        channel,
        channelHash,
        report.candidate_id,
        reportHash,
        row.policy_hash,
        current.releaseId,
        nonce.toString(),
        deadline,
        row.owner,
        row.config_version,
        digest,
        new Date().toISOString(),
      );

      return {
        proposalId,
        digest,
        deadline,
        action: {
          ...action,
          configVersion: Number(action.configVersion),
          nonce: nonce.toString(),
          deadline,
        },
        replaces: current.releaseId === ZERO ? null : current.releaseId,
      };
    }),

    route("POST", /^\/releases\/([0-9a-f-]{36})\/consent$/, async (_req, [proposalId]) => {
      const proposal = loadProposal(db, proposalId);
      if (proposal.status !== "pending") {
        throw bad("wrong_state", `proposal is ${proposal.status}, expected pending`);
      }
      db.query(
        "UPDATE proposals SET status = 'consented', consented_at = ? WHERE proposal_id = ?",
      ).run(new Date().toISOString(), proposalId);
      return { proposalId, status: "consented" };
    }),

    route("POST", /^\/auth\/world\/start$/, async (_req, _p, body: Record<string, unknown>) => {
      const proposalId = requireString(body.proposalId, "proposalId", 64);
      const proposal = loadProposal(db, proposalId);

      // Section 9: authentication identifies a session, it does not mean the
      // person approved a kernel. Consent to THIS digest comes first.
      if (proposal.status !== "consented") {
        throw bad(
          "consent_required",
          "the operator must see the release contents and consent before any identity journey starts",
        );
      }

      const response = await fetch(`${config.bridgeUrl}/journeys`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ proposalId, digest: proposal.digest, deadline: proposal.deadline }),
      }).catch(() => null);

      if (!response) {
        throw new HttpError(
          503,
          "bridge_unreachable",
          `identity bridge at ${config.bridgeUrl} is not responding`,
        );
      }
      const result = (await response.json()) as Record<string, unknown>;

      db.query(
        "UPDATE proposals SET status = 'identity-started', identity_state = ?, identity_detail = ? WHERE proposal_id = ?",
      ).run(String(result.state ?? "unknown"), JSON.stringify(result), proposalId);

      return result;
    }),

    route("GET", /^\/auth\/world\/callback$/, async (req) => {
      // The real OIDC callback validates state, nonce, redirect, token signature,
      // issuer, audience, expiry and PKCE - all of that lives in the bridge,
      // which is the only process holding identity secrets. The API only learns
      // the outcome.
      const url = new URL(req.url);
      const proposalId = url.searchParams.get("proposalId");
      if (!proposalId) throw bad("missing_proposal", "proposalId query parameter is required");
      loadProposal(db, proposalId);

      const response = await fetch(
        `${config.bridgeUrl}/journeys/${proposalId}/complete${url.search}`,
        { method: "POST" },
      ).catch(() => null);
      if (!response) {
        throw new HttpError(503, "bridge_unreachable", "identity bridge is not responding");
      }
      const result = (await response.json()) as Record<string, unknown>;

      db.query(
        "UPDATE proposals SET identity_state = ?, identity_detail = ? WHERE proposal_id = ?",
      ).run(String(result.state ?? "unknown"), JSON.stringify(result), proposalId);

      return result;
    }),

    route("POST", /^\/releases\/([0-9a-f-]{36})\/submit$/, async (_req, [proposalId], body) => {
      const proposal = loadProposal(db, proposalId);
      const row = project(proposal.project_id);

      if (Math.floor(Date.now() / 1000) > proposal.deadline) {
        db.query("UPDATE proposals SET status = 'expired' WHERE proposal_id = ?").run(proposalId);
        throw bad("expired", "the permit expired; the operator must approve again");
      }
      if (proposal.status === "published") {
        return { proposalId, status: "published", releaseId: proposal.release_id, tx: proposal.tx_hash };
      }

      const ownerSignature = (body as { ownerSignature?: string }).ownerSignature;
      if (typeof ownerSignature !== "string" || !/^0x[0-9a-fA-F]+$/.test(ownerSignature)) {
        throw bad("owner_signature_required", "the owner must sign the exact action");
      }

      // Ask the bridge for its permit. It refuses unless its own gates passed.
      const permitResponse = await fetch(`${config.bridgeUrl}/permits`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ proposalId, digest: proposal.digest }),
      }).catch(() => null);
      if (!permitResponse) {
        throw new HttpError(503, "bridge_unreachable", "identity bridge is not responding");
      }
      const permit = (await permitResponse.json()) as {
        signature?: Hex;
        kind?: string;
        state?: string;
        detail?: string;
      };
      if (!permit.signature) {
        throw new HttpError(
          403,
          "permit_refused",
          permit.detail ?? "the identity bridge refused to issue a permit",
          permit,
        );
      }

      db.query(
        "UPDATE proposals SET status = 'permitted', permit_signature = ?, permit_kind = ?, owner_signature = ? WHERE proposal_id = ?",
      ).run(permit.signature, permit.kind ?? "unknown", ownerSignature, proposalId);

      if (!wallet) {
        throw new HttpError(
          503,
          "no_relayer",
          "no relayer key configured, so this API cannot submit the transaction. " +
            "The signatures are stored; submit from a wallet that can pay gas.",
        );
      }

      const tx = await writeAndConfirm(publicClient, wallet, {
        address: config.registry,
        functionName: "promoteRelease",
        args: [
          {
            projectId: proposal.project_id as Hex,
            configVersion: BigInt(proposal.config_version),
            owner: row.owner,
            channelHash: proposal.channel_hash as Hex,
            candidateId: proposal.candidate_id as Hex,
            reportHash: proposal.report_hash as Hex,
            policyHash: proposal.policy_hash as Hex,
            expectedPreviousReleaseId: proposal.expected_previous as Hex,
            nonce: BigInt(proposal.nonce),
            deadline: BigInt(proposal.deadline),
          },
          ownerSignature as Hex,
          permit.signature,
        ],
      });

      const current = await readCurrentRelease(
        publicClient,
        config.registry,
        proposal.project_id as Hex,
        proposal.channel_hash as Hex,
      );

      db.query(
        "UPDATE proposals SET status = 'published', tx_hash = ?, release_id = ? WHERE proposal_id = ?",
      ).run(tx, current.releaseId, proposalId);

      return {
        proposalId,
        status: "published",
        tx,
        releaseId: current.releaseId,
        permitKind: permit.kind,
      };
    }),

    route("GET", /^\/releases\/([0-9a-f-]{36})$/, async (_req, [proposalId]) => {
      const proposal = loadProposal(db, proposalId);
      const current = await readCurrentRelease(
        publicClient,
        config.registry,
        proposal.project_id as Hex,
        proposal.channel_hash as Hex,
      );
      return {
        proposal: {
          ...proposal,
          // Never leak the signatures themselves back out; the fact is enough.
          permit_signature: proposal.permit_signature ? "<present>" : null,
          owner_signature: proposal.owner_signature ? "<present>" : null,
        },
        onchain: current,
      };
    }),

    route("GET", /^\/projects\/(0x[0-9a-fA-F]{64})\/release$/, async (req, [projectId]) => {
      const url = new URL(req.url);
      const channel = url.searchParams.get("channel") ?? "stable";
      return readCurrentRelease(publicClient, config.registry, projectId as Hex, labelHash(channel));
    }),
  ];

  /* ---------------------------------------------------------------------- */

  return {
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);

      if (req.method === "OPTIONS") return json({}, 204, config.webOrigin);

      // SSE is handled outside the JSON router because it never returns.
      const sse = url.pathname.match(/^\/jobs\/([0-9a-f-]{36})\/events$/);
      if (sse && req.method === "GET") {
        return streamJobEvents(db, listeners, sse[1], url, config.webOrigin);
      }

      for (const entry of table) {
        if (req.method !== entry.method) continue;
        const match = url.pathname.match(entry.pattern);
        if (!match) continue;
        try {
          const response = await routes[entry.key](req, match.slice(1));
          return new Response(response.body, {
            status: response.status,
            headers: {
              ...Object.fromEntries(response.headers),
              "access-control-allow-origin": config.webOrigin,
            },
          });
        } catch (error) {
          if (error instanceof HttpError) {
            return json(
              { error: error.code, message: error.message, detail: error.detail },
              error.status,
              config.webOrigin,
            );
          }
          console.error(`[api] ${req.method} ${url.pathname}`, error);
          return json(
            { error: "internal", message: (error as Error).message },
            500,
            config.webOrigin,
          );
        }
      }

      return json({ error: "not_found", message: `no route for ${req.method} ${url.pathname}` }, 404, config.webOrigin);
    },
  };
}

/* -------------------------------------------------------------------------- */

type ProposalRow = {
  proposal_id: string;
  project_id: string;
  channel: string;
  channel_hash: string;
  candidate_id: string;
  report_hash: string;
  policy_hash: string;
  expected_previous: string;
  nonce: string;
  deadline: number;
  owner: string;
  config_version: number;
  digest: string;
  status: string;
  permit_signature: string | null;
  permit_kind: string | null;
  owner_signature: string | null;
  release_id: string | null;
  tx_hash: string | null;
};

function loadProposal(db: Database, proposalId: string): ProposalRow {
  const row = db
    .query("SELECT * FROM proposals WHERE proposal_id = ?")
    .get(proposalId) as ProposalRow | null;
  if (!row) throw notFound("proposal");
  return row;
}

/**
 * Section 3: "Stream structured progress and attempt outcomes."
 *
 * Replays the append-only log from `Last-Event-ID` before following, so a
 * reconnecting browser sees the attempts it missed rather than a gap.
 */
function streamJobEvents(
  db: Database,
  listeners: Map<string, Set<(event: unknown) => void>>,
  jobId: string,
  url: URL,
  origin: string,
): Response {
  const job = db.query("SELECT job_id FROM jobs WHERE job_id = ?").get(jobId);
  if (!job) {
    return json({ error: "not_found", message: "job not found" }, 404, origin);
  }

  const after = Number(url.searchParams.get("after") ?? "0");
  const encoder = new TextEncoder();

  let cleanup = () => {};

  const stream = new ReadableStream({
    start(controller) {
      const write = (event: unknown) => {
        const record = event as { seq?: number };
        const id = record.seq !== undefined ? `id: ${record.seq}\n` : "";
        try {
          controller.enqueue(
            encoder.encode(`${id}data: ${JSON.stringify(event)}\n\n`),
          );
        } catch {
          // The client went away between the check and the write.
          cleanup();
        }
      };

      // Tells the browser how soon to reconnect. A laptop that sleeps drops
      // every open stream; without this the browser default applies and the
      // dashboard sits blank for longer than it needs to.
      controller.enqueue(encoder.encode("retry: 2000\n\n"));

      for (const event of eventsSince(db, jobId, Number.isFinite(after) ? after : 0)) {
        write(event);
      }

      const set = listeners.get(jobId) ?? new Set();
      set.add(write);
      listeners.set(jobId, set);

      // Comment frames keep proxies from closing an idle stream, and are how a
      // half-open socket left behind by a sleeping laptop gets noticed.
      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          cleanup();
        }
      }, 15_000);

      cleanup = () => {
        clearInterval(keepAlive);
        set.delete(write);
        if (set.size === 0) listeners.delete(jobId);
      };
    },
    // Called when the client disconnects. The previous version stashed cleanup
    // on the controller and never ran it, so every reconnect - and a sleeping
    // laptop causes a lot of them - leaked a listener and a 15s interval.
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "access-control-allow-origin": origin,
    },
  });
}

/* -------------------------------------------------------------------------- */

if (import.meta.main) {
  const config = loadConfig();
  const db = openDatabase(config.databasePath);
  const api = createApi(config, db);

  Bun.serve({ port: config.port, fetch: api.fetch, idleTimeout: 0 });

  console.log(`gpu-vtec api    http://127.0.0.1:${config.port}`);
  console.log(`  database      ${config.databasePath}`);
  console.log(`  chain         ${config.chainId} via ${config.rpcUrl}`);
  console.log(`  registry      ${config.registry}`);
  console.log(`  bridge        ${config.bridgeUrl}`);
  console.log(
    config.relayerKey
      ? "  relayer       configured (pays gas; holds no authority)"
      : "  relayer       NOT configured - the API cannot submit transactions",
  );
}
