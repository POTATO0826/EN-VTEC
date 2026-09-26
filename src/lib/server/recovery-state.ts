import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RpContext } from "@worldcoin/idkit";
import { DATA_DIR, dataPath } from "@/lib/server/data-dir";

export type RoyaltyAccount = {
  identity: string;
  address: string;
  aliases: string[];
  worldSessionId?: `session_${string}`;
  enrolledAt?: string;
  challenges: string[];
};
export type RecoveryRequest = {
  id: string;
  kind: "enroll" | "recover";
  identity: string;
  address: string;
  signal: string;
  message: string;
  rp: RpContext;
  expiresAt: number;
  worldSessionId?: `session_${string}`;
  status: "pending" | "verified" | "prepared" | "complete" | "failed";
  stamps?: string[];
  transaction?: { bytes: string; signature: string; digest: string };
  digest?: string;
};
export type RecoveryState = {
  accounts: RoyaltyAccount[];
  requests: RecoveryRequest[];
  usedStamps: string[];
};
const FILE = dataPath("recovery.json");

export async function readRecovery(): Promise<RecoveryState> {
  try {
    return JSON.parse(await readFile(FILE, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      return { accounts: [], requests: [], usedStamps: [] };
    throw e; // Corruption must never silently reset identity or replay protection.
  }
}

export async function saveRecovery(state: RecoveryState) {
  await mkdir(path.dirname(FILE), { recursive: true });
  const temp = `${FILE}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
  await rename(temp, FILE);
}

// The demo runs ONE server process. Publish and recovery share this lock so a
// new listing cannot capture an old payout while recovery is in flight.
const lock = ((
  globalThis as { __vtecRoyalties?: { queue: Promise<unknown> } }
).__vtecRoyalties ??= {
  queue: Promise.resolve(),
});
export function withRoyaltyLock<T>(work: () => Promise<T>): Promise<T> {
  const next = lock.queue.then(work);
  lock.queue = next.catch(() => {});
  return next;
}

export function accountFor(
  state: RecoveryState,
  address: string,
): RoyaltyAccount | undefined {
  return state.accounts.find(
    (a) =>
      a.identity === address ||
      a.address === address ||
      a.aliases.includes(address),
  );
}

export function ensureAccount(
  state: RecoveryState,
  address: string,
): RoyaltyAccount {
  const existing = accountFor(state, address);
  if (existing) return existing;
  const account = {
    identity: address,
    address,
    aliases: [address],
    challenges: [],
  };
  state.accounts.push(account);
  return account;
}

export function assertNoRecoveryInFlight(
  state: RecoveryState,
  identity: string,
) {
  if (
    state.requests.some(
      (r) =>
        r.identity === identity &&
        (r.status === "verified" || r.status === "prepared"),
    )
  ) {
    throw new Error(
      "A recovery is awaiting settlement. Resume it before listing or starting another recovery.",
    );
  }
}
