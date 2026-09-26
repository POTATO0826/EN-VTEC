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

export type Approval = {
  id: string;
  sessionId: string;
  trackId: string;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string | null;
  interval: number;
  expiresAt: number;
  status: "pending" | "approved" | "denied" | "expired";
  sub: string | null;
};

export type Submission = {
  id: string;
  sessionId: string;
  trackId: string;
  approvalId: string | null;
  buildSha256: string;
  resultSha256: string;
  seconds: number;
  gpu: string;
  at: string;
};

type Data = {
  seats: Seat[];
  agents: AgentInfo[];
  approvals: Approval[];
  submissions: Submission[];
};

const FILE = path.join(process.cwd(), ".data", "vtec.json");
const EMPTY: Data = { seats: [], agents: [], approvals: [], submissions: [] };

async function read(): Promise<Data> {
  try {
    return { ...EMPTY, ...(JSON.parse(await readFile(FILE, "utf8")) as Data) };
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
