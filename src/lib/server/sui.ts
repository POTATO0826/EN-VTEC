import "server-only";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { getJsonRpcFullnodeUrl, SuiJsonRpcClient, type SuiEvent } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";

/**
 * Sui testnet: the vtec::vault Move package holds stakes, draws verifier
 * seeds on-chain and pays royalties. The server never trusts a digest a
 * browser sends it: it reads the transaction from the chain and checks the
 * event the contract emitted.
 */

export const sui = {
  network: (process.env.NEXT_PUBLIC_SUI_NETWORK ?? "testnet") as "testnet" | "devnet" | "mainnet",
  packageId: process.env.NEXT_PUBLIC_SUI_PACKAGE_ID ?? "",
  vaultId: process.env.NEXT_PUBLIC_SUI_VAULT_ID ?? "",
  adminCapId: process.env.SUI_ADMIN_CAP_ID ?? "",
  adminKey: process.env.SUI_ADMIN_KEY ?? "",
  stakeMist: BigInt(Math.round(Number(process.env.NEXT_PUBLIC_STAKE_SUI ?? "1") * 1e9)),
};

export function missingSuiEnv(): string[] {
  const missing: string[] = [];
  if (!sui.packageId) missing.push("NEXT_PUBLIC_SUI_PACKAGE_ID");
  if (!sui.vaultId) missing.push("NEXT_PUBLIC_SUI_VAULT_ID");
  return missing;
}

export function adminReady() {
  return !!(sui.adminCapId && sui.adminKey && sui.packageId && sui.vaultId);
}

const client = new SuiJsonRpcClient({ network: sui.network, url: getJsonRpcFullnodeUrl(sui.network) });

/** The on-chain key for a stake or royalty: the approval/submission id as bytes. */
export function keyBytes(id: string) {
  return Array.from(new TextEncoder().encode(id));
}

function sameBytes(a: unknown, b: number[]) {
  return Array.isArray(a) && a.length === b.length && a.every((x, i) => Number(x) === b[i]);
}

async function eventsOf(digest: string) {
  const tx = await client.waitForTransaction({
    digest,
    options: { showEvents: true, showEffects: true },
    timeout: 30_000,
  });
  if (tx.effects?.status.status !== "success") throw new Error("Transaction failed on-chain.");
  return tx.events ?? [];
}

function find(events: SuiEvent[], name: string) {
  return events.filter((e) => e.type === `${sui.packageId}::vault::${name}`);
}

/** Checks a Staked event for this key with the full stake amount. */
export async function checkStake(digest: string, key: string) {
  const staked = find(await eventsOf(digest), "Staked").find((e) => {
    const json = e.parsedJson as { submission: unknown; amount: string };
    return sameBytes(json.submission, keyBytes(key)) && BigInt(json.amount) >= sui.stakeMist;
  });
  if (!staked) throw new Error("No matching stake in that transaction.");
  const json = staked.parsedJson as { owner: string; amount: string };
  return { owner: json.owner, amountMist: json.amount };
}

/** Checks a RoyaltyPaid event for this submission, paid to the right tuner. */
export async function checkRoyalty(digest: string, submissionId: string, tuner: string, minMist: bigint) {
  const paid = find(await eventsOf(digest), "RoyaltyPaid").find((e) => {
    const json = e.parsedJson as { submission: unknown; tuner: string; amount: string };
    return (
      sameBytes(json.submission, keyBytes(submissionId)) &&
      json.tuner.toLowerCase() === tuner.toLowerCase() &&
      BigInt(json.amount) >= minMist
    );
  });
  if (!paid) throw new Error("No matching royalty payment in that transaction.");
  const json = paid.parsedJson as { payer: string; amount: string };
  return { payer: json.payer, amountMist: json.amount };
}

/* -------------------------------------------------------------------------- */
/* Admin actions (server key)                                                  */
/* -------------------------------------------------------------------------- */

function admin() {
  const { secretKey } = decodeSuiPrivateKey(sui.adminKey);
  return Ed25519Keypair.fromSecretKey(secretKey);
}

async function run(build: (tx: Transaction) => void) {
  const tx = new Transaction();
  build(tx);
  const res = await client.signAndExecuteTransaction({
    transaction: tx,
    signer: admin(),
    options: { showEvents: true, showEffects: true },
  });
  if (res.effects?.status.status !== "success") {
    throw new Error(res.effects?.status.error ?? "Admin transaction failed.");
  }
  await client.waitForTransaction({ digest: res.digest });
  return res;
}

/** Draws a random seed on-chain for picking this submission's verifiers. */
export async function drawSeed(submissionId: string) {
  const res = await run((tx) =>
    tx.moveCall({
      target: `${sui.packageId}::vault::draw`,
      arguments: [tx.object("0x8"), tx.pure.vector("u8", keyBytes(submissionId))],
    }),
  );
  const event = (res.events ?? []).find((e) => e.type === `${sui.packageId}::vault::VerifierDraw`);
  const seed = (event?.parsedJson as { seed?: string } | undefined)?.seed;
  if (!seed) throw new Error("Draw returned no seed.");
  return { seed, digest: res.digest };
}

export function settleStake(key: string, outcome: "release" | "forfeit") {
  return run((tx) =>
    tx.moveCall({
      target: `${sui.packageId}::vault::${outcome}`,
      arguments: [tx.object(sui.adminCapId), tx.object(sui.vaultId), tx.pure.vector("u8", keyBytes(key))],
    }),
  );
}

export function explorerTx(digest: string) {
  return `https://suiscan.xyz/${sui.network}/tx/${digest}`;
}
