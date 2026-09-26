import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { HARNESS_ENABLED, harnessRunning, PLATFORM_CODE, PLATFORM_SESSION, runHarness } from "./harness";
import { hasBuild, load, update, type Submission, type VerifyReport } from "./store";
import { adminAddress, adminReady, distributeFee, drawSeed, refundFee, settleStake } from "./sui";

/**
 * Independent verification of a submission.
 *
 *   pending   -> waiting for enough verifiers in the pool
 *   verifying -> POOL_SIZE verifiers drawn at random; each approves with
 *                World ID, runs baseline vs candidate on their own machine,
 *                commits a hash of their report, then reveals it once every
 *                assigned verifier has committed (so nobody can copy)
 *   verified  -> QUORUM verifiers say: same output, faster by more than 1%
 *                and by more than their measured noise. Stake released.
 *   rejected  -> quorum can no longer be reached. Stake forfeited to the
 *                verifier reward pool.
 *
 * With too few human verifiers (early days, or a solo demo), the platform
 * harness fills in as one verifier, and the quorum shrinks to the number of
 * verifiers actually drawn so the submission still gets decided. That's
 * weaker than 3 independent people, so it's stored and shown on the result.
 */

export const POOL_SIZE = Number(process.env.VERIFIER_POOL_SIZE ?? 5);
export const QUORUM = Number(process.env.VERIFIER_QUORUM ?? 3);

function hash(...parts: string[]) {
  const h = createHash("sha256");
  for (const part of parts) h.update(part);
  return h.digest("hex");
}

/** Deterministic shuffle: anyone with the seed can recompute the pick. */
function pick(seed: string, sessionIds: string[], count: number) {
  return [...sessionIds]
    .sort((a, b) => hash(seed, a).localeCompare(hash(seed, b)))
    .slice(0, count);
}

// Shared across module copies (see harness.ts): one draw at a time, since
// each can wait on a Sui transaction and must not assign twice.
const lock = ((globalThis as { __vtecAssign?: { busy: boolean } }).__vtecAssign ??= { busy: false });

/** Draws verifiers for every pending submission that now has enough candidates. */
export async function assignPending() {
  if (lock.busy) return;
  lock.busy = true;
  try {
    await assignAll();
  } finally {
    lock.busy = false;
  }
}

async function assignAll() {
  const data = await load();
  let harnessNeeded = false;
  // Submissions from before builds were uploaded have no code to re-run.
  for (const sub of data.submissions.filter((s) => s.status === "pending" && hasBuild(s.buildSha256))) {
    const candidates = data.verifiers
      .map((v) => v.sessionId)
      .filter((id) => id !== sub.sessionId && id !== PLATFORM_SESSION);
    if (candidates.length < QUORUM && !HARNESS_ENABLED) continue;

    // Prefer Sui's on-chain randomness; fall back to server randomness,
    // labelled as such, when the admin key isn't configured.
    let draw: NonNullable<Submission["draw"]>;
    try {
      draw = adminReady()
        ? await drawSeed(sub.id).then((d) => ({ seed: d.seed, source: d.digest }))
        : { seed: randomBytes(32).toString("hex"), source: "server" };
    } catch (e) {
      console.warn("[verify] on-chain draw failed:", e instanceof Error ? e.message : e);
      draw = { seed: randomBytes(32).toString("hex"), source: "server" };
    }

    const chosen = pick(draw.seed, candidates, POOL_SIZE);
    const usesHarness = chosen.length < QUORUM;
    if (usesHarness) {
      chosen.push(PLATFORM_SESSION);
      harnessNeeded = true;
    }
    await update((d) => {
      const s = d.submissions.find((x) => x.id === sub.id);
      if (!s || s.status !== "pending") return;
      s.status = "verifying";
      s.draw = draw;
      s.quorum = Math.min(QUORUM, chosen.length);
      s.harness = usesHarness;
      if (usesHarness) ensurePlatformAgent(d);
      for (const sessionId of chosen) {
        const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
        d.assignments.push({
          id,
          submissionId: s.id,
          sessionId,
          // The harness isn't a person, so there's no World ID step for it.
          status: sessionId === PLATFORM_SESSION ? "approved" : "assigned",
          action: `vtec-verify:${s.id}:${id}`,
          nullifier: null,
          commit: null,
          report: null,
          at: new Date().toISOString(),
        });
      }
    });
  }
  if (harnessNeeded) runHarness();
}

/** The harness pairs like any agent, with this machine's hardware. */
function ensurePlatformAgent(d: Parameters<Parameters<typeof update>[0]>[0]) {
  if (d.agents.some((a) => a.code === PLATFORM_CODE)) return;
  d.agents.push({
    code: PLATFORM_CODE,
    sessionId: PLATFORM_SESSION,
    hostname: "platform harness",
    os: process.platform,
    cpu: "",
    gpus: [],
    lastSeen: new Date().toISOString(),
  });
}

/**
 * Called whenever someone looks at progress: draws verifiers for anything
 * still waiting, and restarts the harness if it has unfinished jobs (for
 * example after the server restarted mid-run).
 */
export async function kick() {
  const data = await load();
  if (data.submissions.some((s) => s.status === "pending" && hasBuild(s.buildSha256))) await assignPending();
  const harnessJobs = data.assignments.some(
    (a) => a.sessionId === PLATFORM_SESSION && (a.status === "approved" || a.status === "committed"),
  );
  if (harnessJobs && !harnessRunning()) runHarness();
}

/** Reveals open once every assigned verifier has committed. */
export function revealOpen(statuses: string[]) {
  return statuses.length > 0 && statuses.every((s) => s === "committed" || s === "revealed");
}

export function commitOf(report: VerifyReport, salt: string) {
  return hash(JSON.stringify(report), salt);
}

/** Decides a submission once the revealed reports settle it either way. */
export async function tally(submissionId: string, revealedId?: string) {
  const data = await load();
  const sub = data.submissions.find((s) => s.id === submissionId);
  if (!sub) return;

  // Already decided before this verifier revealed: still score them.
  if (sub.status === "verified" || sub.status === "rejected") {
    await update((d) => {
      const a = d.assignments.find((x) => x.id === revealedId);
      const v = d.verifiers.find((x) => x.sessionId === a?.sessionId);
      if (a?.report?.compatible && v) v.reputation += a.report.pass === (sub.status === "verified") ? 1 : -1;
    });
    return;
  }
  if (sub.status !== "verifying") return;

  // Reports that arrived during this call are in a fresh read, not `data`.
  const assigned = (await load()).assignments.filter((a) => a.submissionId === submissionId);
  const revealed = assigned.filter((a) => a.status === "revealed" && a.report);
  const eligible = assigned.filter((a) => a.report?.compatible !== false);
  const passes = revealed.filter((a) => a.report!.compatible && a.report!.pass);
  const fails = revealed.filter((a) => a.report!.compatible && !a.report!.pass);

  const quorum = sub.quorum ?? QUORUM;
  let outcome: "verified" | "rejected" | null = null;
  if (passes.length >= quorum) outcome = "verified";
  else if (eligible.length - fails.length < quorum) outcome = "rejected";
  if (!outcome) return;

  const speeds = passes.map((a) => a.report!.speedup).sort((a, b) => a - b);
  const median = speeds.length ? speeds[Math.floor(speeds.length / 2)] : null;

  await update((d) => {
    const s = d.submissions.find((x) => x.id === submissionId);
    if (!s || s.status !== "verifying") return;
    s.status = outcome;
    s.speedup = outcome === "verified" ? median : null;
    s.settledAt = new Date().toISOString();

    // Verifiers who agreed with the outcome gain reputation; outliers lose it.
    for (const a of d.assignments.filter((x) => x.submissionId === submissionId && x.report?.compatible)) {
      const v = d.verifiers.find((x) => x.sessionId === a.sessionId);
      if (v) v.reputation += (a.report!.pass === (outcome === "verified")) ? 1 : -1;
    }
  });

  const approval = data.approvals.find((a) => a.id === sub.approvalId);

  // The process fee pays the verifiers who actually ran the check, whatever
  // they found. The platform harness's share goes to the platform wallet.
  if (approval?.fee && adminReady()) {
    const ran = assigned.filter((a) => a.report?.compatible);
    try {
      const fresh = await load();
      const recipients = ran.map((a) =>
        a.sessionId === PLATFORM_SESSION ? adminAddress() : (fresh.payouts[a.sessionId] ?? adminAddress()),
      );
      const res = recipients.length ? await distributeFee(approval.id, recipients) : await refundFee(approval.id);
      await update((d) => {
        const s = d.submissions.find((x) => x.id === submissionId);
        if (s) s.feeSettlement = { digest: res.digest, recipients };
      });
    } catch (e) {
      console.warn("[verify] fee settlement failed:", e instanceof Error ? e.message : e);
    }
  }

  // Legacy: stakes from before the process fee replaced them.
  if (approval?.kind === "stake" && adminReady()) {
    try {
      await settleStake(approval.id, outcome === "verified" ? "release" : "forfeit");
    } catch (e) {
      console.warn("[verify] stake settlement failed:", e instanceof Error ? e.message : e);
    }
  }
}
