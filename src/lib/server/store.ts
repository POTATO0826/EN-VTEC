import "server-only";
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
 * Permission for one agent submission to one track. World ID verified users
 * approve with World ID; everyone else stakes SUI instead.
 */
export type Approval = {
  id: string;
  sessionId: string;
  trackId: string;
  kind: "worldid" | "stake";
  action: string;
  status: "pending" | "approved";
  nullifier: string | null;
  stake: { digest: string; owner: string; amountMist: string } | null;
  at: string;
};

export type SubmissionStatus = "pending" | "verifying" | "verified" | "rejected";

export type BuildRequirements = {
  /** Minimum NVIDIA driver, e.g. "570". */
  nvidiaDriver?: string;
  /** ffmpeg encoders the build calls, e.g. ["h264_nvenc"]. */
  ffmpegEncoders?: string[];
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

export type Royalty = {
  submissionId: string;
  payer: string;
  tuner: string;
  amountMist: string;
  digest: string;
  at: string;
};

type Data = {
  seats: Seat[];
  agents: AgentInfo[];
  approvals: Approval[];
  submissions: Submission[];
  verifiers: Verifier[];
  assignments: Assignment[];
  royalties: Royalty[];
  /** sessionId -> Sui address that receives royalties */
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
  royalties: [],
  payouts: {},
};

async function read(): Promise<Data> {
  try {
    return { ...structuredClone(EMPTY), ...(JSON.parse(await readFile(FILE, "utf8")) as Data) };
  } catch {
    return structuredClone(EMPTY);
  }
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

export async function loadBuild(sha256: string): Promise<BuildBundle | null> {
  if (!/^[0-9a-f]{64}$/.test(sha256)) return null;
  try {
    return JSON.parse(await readFile(path.join(BUILDS, `${sha256}.json`), "utf8")) as BuildBundle;
  } catch {
    return null;
  }
}
