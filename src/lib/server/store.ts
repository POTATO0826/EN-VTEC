import "server-only";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * One JSON file under .data/. Enough for a local demo and a single server.
 * On Vercel the filesystem is wiped between deploys, so swap this for a real
 * database (Vercel KV / Postgres) before anyone depends on it.
 */

export type Seat = {
  nullifier: string;
  sessionId: string;
  at: string;
};

export type AgentInfo = {
  code: string;
  sessionId: string | null;
  hostname: string;
  os: string;
  cpu: string;
  gpus: { name: string; memoryMb: number | null; driver: string | null }[];
  lastSeen: string;
};

/**
 * Permission for one agent submission to one track: a World ID approval,
 * then the process fee paid on Sui.
 */
export type Approval = {
  id: string;
  sessionId: string;
  trackId: string;
  kind: "worldid";
  action: string;
  status: "pending" | "approved";
  nullifier: string | null;
  /** The process fee, paid after the World ID approval. */
  fee: { digest: string; payer: string; amountMist: string } | null;
  at: string;
};

export type SubmissionStatus = "pending" | "verifying" | "verified" | "rejected";

export type BuildRequirements = {
  /** Minimum NVIDIA driver, e.g. "570". */
  nvidiaDriver?: string;
};

export type Submission = {
  id: string;
  sessionId: string;
  trackId: string;
  approvalId: string | null;
  buildName: string;
  buildSha256: string;
  specSha256: string;
  resultSha256: string;
  seconds: number;
  gpu: string;
  requires: BuildRequirements;
  status: SubmissionStatus;
  /** Where the verifier pool was drawn from: a Sui tx digest, or "server". */
  draw: { seed: string; source: string } | null;
  /** Median speedup reported by the verifiers who passed it. */
  speedup: number | null;
  payout: string | null;
  /** How many verifiers must agree (fewer than 3 only when the pool is small). */
  quorum?: number;
  /** True when the platform harness had to stand in for missing verifiers. */
  harness?: boolean;
  /** Where the process fee went once verification ended. */
  feeSettlement?: { digest: string; recipients: string[] } | null;
  /** On sale once verified: the shared Listing on Sui. */
  listing?: { id: string; digest: string; lineage: string; royalties?: string } | null;
  at: string;
  settledAt: string | null;
};

export type Verifier = {
  sessionId: string;
  joinedAt: string;
  reputation: number;
};

export type VerifyReport = {
  compatible: boolean;
  reason?: string;
  hardware: string;
  hashMatches: boolean;
  correct: boolean;
  runs: number;
  baselineMedianMs: number;
  candidateMedianMs: number;
  noisePct: number;
  speedup: number;
  pass: boolean;
  /** Every timed run, in order (reports from older agents only have the medians). */
  baselineMs?: number[];
  candidateMs?: number[];
  /** The warm-up run, which pays for compilation and caches. */
  warmupBaselineMs?: number;
  warmupCandidateMs?: number;
  /** Largest |candidate − baseline| over every run's output; null when the track has no tensor check. */
  maxError?: number | null;
  tolerance?: number;
};

export type Assignment = {
  id: string;
  submissionId: string;
  sessionId: string;
  status: "assigned" | "approved" | "committed" | "revealed";
  /** World ID action this verifier must approve before running. */
  action: string;
  nullifier: string | null;
  commit: string | null;
  report: VerifyReport | null;
  at: string;
};

type Data = {
  seats: Seat[];
  agents: AgentInfo[];
  approvals: Approval[];
  submissions: Submission[];
  verifiers: Verifier[];
  assignments: Assignment[];
  /** sessionId -> the Sui address bound to its World ID (holds the HumanPass) */
  payouts: Record<string, string>;
};

const FILE = path.join(process.cwd(), ".data", "vtec.json");
const EMPTY: Data = {
  seats: [],
  agents: [],
  approvals: [],
  submissions: [],
  verifiers: [],
  assignments: [],
  payouts: {},
};

async function read(): Promise<Data> {
  let data: Data;
  try {
    data = { ...structuredClone(EMPTY), ...(JSON.parse(await readFile(FILE, "utf8")) as Data) };
  } catch {
    return structuredClone(EMPTY);
  }
  return upgrade(data);
}

/**
 * Records saved by older versions of the app miss fields added since. Fill
 * them with safe defaults so old data can't crash a page.
 */
function upgrade(data: Data): Data {
  for (const a of data.approvals) {
    a.kind ??= "worldid";
    a.fee ??= null;
    a.nullifier ??= null;
    a.action ??= "";
  }
  for (const s of data.submissions) {
    s.status ??= "pending";
    s.buildName ??= "build";
    s.specSha256 ??= "";
    s.requires ??= {};
    s.draw ??= null;
    s.speedup ??= null;
    s.payout ??= null;
    s.settledAt ??= null;
  }
  for (const v of data.verifiers) v.reputation ??= 0;
  return data;
}

// Writes are serialised so two requests can't interleave read-modify-write.
let queue: Promise<unknown> = Promise.resolve();

export function load() {
  return read();
}

export function update<T>(fn: (data: Data) => T): Promise<T> {
  const run = queue.then(async () => {
    const data = await read();
    const result = fn(data);
    await mkdir(path.dirname(FILE), { recursive: true });
    await writeFile(FILE, JSON.stringify(data, null, 2));
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

/* -------------------------------------------------------------------------- */
/* Build bundles: the exact files a tuner submitted, so verifiers run the same */
/* code. Stored by content hash.                                               */
/* -------------------------------------------------------------------------- */

const BUILDS = path.join(process.cwd(), ".data", "builds");

export type BuildBundle = { name: string; files: Record<string, string> };

export async function saveBuild(sha256: string, bundle: BuildBundle) {
  await mkdir(BUILDS, { recursive: true });
  await writeFile(path.join(BUILDS, `${sha256}.json`), JSON.stringify(bundle));
}

export function hasBuild(sha256: string) {
  return /^[0-9a-f]{64}$/.test(sha256) && existsSync(path.join(BUILDS, `${sha256}.json`));
}

export async function loadBuild(sha256: string): Promise<BuildBundle | null> {
  if (!/^[0-9a-f]{64}$/.test(sha256)) return null;
  try {
    return JSON.parse(await readFile(path.join(BUILDS, `${sha256}.json`), "utf8")) as BuildBundle;
  } catch {
    return null;
  }
}
