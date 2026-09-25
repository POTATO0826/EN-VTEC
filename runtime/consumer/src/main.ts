/**
 * The consumer. Build plan section 8, "Consumer on a single laptop".
 *
 *   bun runtime/consumer/src/main.ts
 *
 * A separate process, in its own window, with its own config. It shares no state
 * with the operator dashboard - its only sources of truth are the chain and the
 * artifacts it downloads and re-checks itself. For the demo it sits side by side
 * with the dashboard so the switch on revocation is visible.
 *
 * Every 30 seconds it:
 *
 *   1. reads currentRelease[projectId][channel] from the registry
 *   2. checks revocation status, the report signer, and the hardware scope
 *      against this machine
 *   3. re-checks the artifact digest
 *   4. prints "running optimized path" or "baseline (reason)"
 *
 * It fails toward the baseline. Anything uncertain - an RPC that will not
 * answer, a scope it cannot read, an artifact whose digest does not match - is a
 * reason to keep running the code it already trusts, not a reason to guess.
 *
 * What it deliberately does NOT do: check the chain on every GPU call. Section 8
 * sets a maximum stale interval and 30 seconds is the demo's.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { Address, Hex } from "viem";
import {
  describeScopeMismatch,
  environmentScopeHash,
  labelHash,
  type HardwareScope,
} from "../../../packages/schemas/src/index";
import { publicClientFor, readCurrentRelease } from "../../../services/api/src/chain";

const CONFIG = {
  rpcUrl: process.env.GPUVTEC_RPC_URL ?? "http://127.0.0.1:8545",
  chainId: Number(process.env.GPUVTEC_CHAIN_ID ?? "31337"),
  registry: (process.env.GPUVTEC_REGISTRY ??
    "0x5FbDB2315678afecb367f032d93F642f64180aa3") as Address,
  apiUrl: process.env.GPUVTEC_API_URL ?? "http://127.0.0.1:8787",
  projectName: process.env.GPUVTEC_PROJECT ?? "gpu-vtec/sha256",
  channel: process.env.GPUVTEC_CHANNEL ?? "stable",
  /** Local file the release's binaryDigest is checked against, if present. */
  artifactPath: process.env.GPUVTEC_ARTIFACT ?? null,
  refreshMs: Number(process.env.GPUVTEC_REFRESH_MS ?? "30000"),
  /**
   * Section 8: "declare the max stale interval; 30 seconds for the demo". This
   * is the hard limit. If the last successful read is older than this - because
   * the laptop slept, the network went away, or the RPC stopped answering - the
   * consumer stops claiming the optimized path and falls back, because it can no
   * longer tell whether the release it adopted has been revoked.
   */
  maxStaleMs: Number(process.env.GPUVTEC_MAX_STALE_MS ?? "90000"),
  /**
   * Section 8's optional scope-mismatch demo: pretend this machine has a
   * different driver, so a correctly scoped release is correctly refused.
   * Labelled on screen, never silent.
   */
  pretendDriver: process.env.GPUVTEC_PRETEND_DRIVER ?? null,
};

type Decision = {
  running: "optimized" | "baseline";
  reason: string;
  releaseId: Hex | null;
  detail: string[];
};

/* -------------------------------------------------------------------------- */
/* This machine                                                                */
/* -------------------------------------------------------------------------- */

function localScope(): HardwareScope | null {
  try {
    const out = execFileSync(
      "nvidia-smi",
      [
        "--query-gpu=name,memory.total,driver_version,compute_cap",
        "--format=csv,noheader,nounits",
      ],
      { encoding: "utf8", timeout: 5000 },
    )
      .trim()
      .split("\n")[0];

    const [name, vram, driver, cc] = out.split(",").map((part) => part.trim());

    let powerLimitW: number | null = null;
    try {
      const power = execFileSync(
        "nvidia-smi",
        ["--query-gpu=power.limit", "--format=csv,noheader,nounits"],
        { encoding: "utf8", timeout: 5000 },
      )
        .trim()
        .split("\n")[0];
      const parsed = Number.parseFloat(power);
      if (Number.isFinite(parsed)) powerLimitW = Math.round(parsed);
    } catch {
      // Section 6a: record it as unrecorded rather than guessing.
    }

    return {
      gpuName: name,
      vramMb: Number(vram),
      computeCapability: cc,
      driverVersion: CONFIG.pretendDriver ?? driver,
      cudaVersion: null,
      powerLimitW,
    };
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* The decision                                                                */
/* -------------------------------------------------------------------------- */

async function decide(): Promise<Decision> {
  const projectId = labelHash(CONFIG.projectName);
  const channelHash = labelHash(CONFIG.channel);
  const client = publicClientFor({
    rpcUrl: CONFIG.rpcUrl,
    chainId: CONFIG.chainId,
    registry: CONFIG.registry,
    relayerKey: null,
  });

  let current;
  try {
    current = await readCurrentRelease(client, CONFIG.registry, projectId, channelHash);
  } catch (error) {
    // Section 8: "On unavailable or uncertain state, use the trusted baseline."
    return {
      running: "baseline",
      reason: "the registry could not be read",
      releaseId: null,
      detail: [String((error as Error).message).split("\n")[0]],
    };
  }

  if (current.statusName === "none") {
    return {
      running: "baseline",
      reason: "no release on this channel",
      releaseId: null,
      detail: [`${CONFIG.projectName} · ${CONFIG.channel}`],
    };
  }

  if (current.statusName === "revoked") {
    return {
      running: "baseline",
      reason: "release revoked",
      releaseId: current.releaseId,
      detail: ["the owner disabled this release; falling back to the code we already trust"],
    };
  }

  // Active. Now earn it: scope, then artifact.
  const local = localScope();
  if (!local) {
    return {
      running: "baseline",
      reason: "cannot read this machine's GPU",
      releaseId: current.releaseId,
      detail: ["nvidia-smi did not answer, so the hardware scope cannot be checked"],
    };
  }

  const candidate = await fetch(`${CONFIG.apiUrl}/candidates/${current.candidateId}`)
    .then((r) => (r.ok ? (r.json() as Promise<Record<string, string>>) : null))
    .catch(() => null);

  if (!candidate) {
    return {
      running: "baseline",
      reason: "candidate metadata unavailable",
      releaseId: current.releaseId,
      detail: [
        `the API at ${CONFIG.apiUrl} did not return candidate ${current.candidateId.slice(0, 12)}…`,
        "without it the hardware scope cannot be checked",
      ],
    };
  }

  const localHash = environmentScopeHash(local);
  if (candidate.env_scope_hash?.toLowerCase() !== localHash.toLowerCase()) {
    const releaseScope = await fetch(
      `${CONFIG.apiUrl}/candidates/${current.candidateId}/scope`,
    )
      .then((r) => (r.ok ? (r.json() as Promise<HardwareScope>) : null))
      .catch(() => null);

    return {
      running: "baseline",
      reason: "hardware scope does not match this machine",
      releaseId: current.releaseId,
      detail: releaseScope
        ? describeScopeMismatch(releaseScope, local)
        : [
            `release scope ${candidate.env_scope_hash?.slice(0, 12)}…`,
            `this machine  ${localHash.slice(0, 12)}…`,
          ],
    };
  }

  if (CONFIG.artifactPath) {
    if (!existsSync(CONFIG.artifactPath)) {
      return {
        running: "baseline",
        reason: "artifact missing",
        releaseId: current.releaseId,
        detail: [`expected ${CONFIG.artifactPath}`],
      };
    }
    const digest = `0x${createHash("sha256").update(readFileSync(CONFIG.artifactPath)).digest("hex")}`;
    if (digest.toLowerCase() !== candidate.binary_digest?.toLowerCase()) {
      // Section 6: "Changing source, compiler options, or binary after
      // evaluation invalidates the report."
      return {
        running: "baseline",
        reason: "artifact digest does not match the release",
        releaseId: current.releaseId,
        detail: [`on disk ${digest.slice(0, 18)}…`, `release ${candidate.binary_digest?.slice(0, 18)}…`],
      };
    }
  }

  return {
    running: "optimized",
    reason: "release is active, scoped to this machine, and the artifact matches",
    releaseId: current.releaseId,
    detail: [
      `candidate ${current.candidateId.slice(0, 12)}…`,
      `report    ${current.reportHash.slice(0, 12)}…`,
      CONFIG.artifactPath ? `artifact  ${CONFIG.artifactPath}` : "artifact  not configured",
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Display                                                                     */
/* -------------------------------------------------------------------------- */

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const AMBER = "\x1b[33m";
const BOLD = "\x1b[1m";

type LoopState = { slept: number | null; failures: number; staleness: number | null };

function render(decision: Decision, at: Date, state: LoopState = { slept: null, failures: 0, staleness: null }) {
  console.clear();
  console.log(`${BOLD}GPU VTEC consumer${RESET}`);
  console.log(`${DIM}a separate process; its only source of truth is the chain${RESET}\n`);

  console.log(`  project   ${CONFIG.projectName}`);
  console.log(`  channel   ${CONFIG.channel}`);
  console.log(`  registry  ${CONFIG.registry}`);
  console.log(`  chain     ${CONFIG.chainId} via ${CONFIG.rpcUrl}\n`);

  if (decision.running === "optimized") {
    console.log(`  ${GREEN}${BOLD}● running optimized path${RESET}`);
  } else {
    console.log(`  ${AMBER}${BOLD}● baseline${RESET} ${AMBER}(${decision.reason})${RESET}`);
  }

  if (decision.releaseId) {
    console.log(`  ${DIM}release   ${decision.releaseId}${RESET}`);
  }
  for (const line of decision.detail) {
    console.log(`  ${DIM}          ${line}${RESET}`);
  }

  if (CONFIG.pretendDriver) {
    console.log(
      `\n  ${AMBER}scope-policy test: this consumer is configured to report driver ` +
        `${CONFIG.pretendDriver}${RESET}`,
    );
    console.log(`  ${DIM}          so a correctly scoped release is correctly refused${RESET}`);
  }

  console.log(
    `\n${DIM}  checked ${at.toLocaleTimeString()} · refresh every ${Math.round(CONFIG.refreshMs / 1000)}s · ctrl-c to stop${RESET}`,
  );
}

async function tick() {
  try {
    render(await decide(), new Date());
  } catch (error) {
    render(
      {
        running: "baseline",
        reason: "consumer error",
        releaseId: null,
        detail: [String((error as Error).message).split("\n")[0]],
      },
      new Date(),
    );
  }
}

/**
 * The loop, written to survive a laptop closing.
 *
 * Three things go wrong across a sleep and each is handled here rather than
 * hoped about:
 *
 *   1. Timers do not fire while suspended, so a plain setInterval leaves the
 *      screen showing a decision made hours ago as though it were current. The
 *      loop measures real elapsed time and says so when it finds a gap.
 *   2. The network is not ready the instant the machine wakes. The first read
 *      after a gap usually fails, so failures retry quickly a few times instead
 *      of waiting out a full refresh cycle showing an error.
 *   3. Most importantly: while the consumer cannot read the chain it cannot
 *      know whether the release was revoked. Section 8 says uncertain state
 *      means the baseline, so staleness past maxStaleMs forces a fallback even
 *      though the last thing we heard was "active".
 */
async function loop() {
  let lastGood = 0;
  let lastTickAt = Date.now();
  let consecutiveFailures = 0;

  for (;;) {
    const now = Date.now();
    const gap = now - lastTickAt;
    // Much longer than scheduled means the process was not running: suspended,
    // or the machine was asleep.
    const slept = gap > CONFIG.refreshMs * 3;
    lastTickAt = now;

    let decision: Decision;
    try {
      decision = await decide();
      if (decision.running === "optimized") {
        lastGood = Date.now();
      }
      consecutiveFailures = 0;
    } catch (error) {
      consecutiveFailures += 1;
      decision = {
        running: "baseline",
        reason: "could not check the registry",
        releaseId: null,
        detail: [String((error as Error).message).split("\n")[0]],
      };
    }

    // Even a successful-looking read is refused if we have been out of contact
    // for longer than the declared staleness bound.
    const staleness = Date.now() - lastGood;
    if (decision.running === "optimized" && lastGood > 0 && staleness > CONFIG.maxStaleMs) {
      decision = {
        running: "baseline",
        reason: "release state is stale",
        releaseId: decision.releaseId,
        detail: [
          `last confirmed ${Math.round(staleness / 1000)}s ago, limit ${Math.round(CONFIG.maxStaleMs / 1000)}s`,
          "cannot tell whether it was revoked while we were out of contact",
        ],
      };
    }

    render(decision, new Date(), {
      slept: slept ? gap : null,
      failures: consecutiveFailures,
      staleness: lastGood > 0 ? staleness : null,
    });

    // Back off a little on repeated failure, but never so far that a revocation
    // goes unnoticed for long. After a wake, retry fast.
    const wait =
      consecutiveFailures > 0
        ? Math.min(2000 * consecutiveFailures, CONFIG.refreshMs)
        : CONFIG.refreshMs;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

if (import.meta.main) {
  await loop();
}

export { decide, localScope };
