import "server-only";
import { bcs } from "@mysten/sui/bcs";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";

/**
 * Sui testnet: the vtec::vault Move package holds stakes, draws verifier
 * seeds on-chain and pays royalties. The server never trusts a digest a
 * browser sends it: it reads the transaction from the chain and decodes the
 * event the contract emitted.
 *
 * Public fullnodes only serve gRPC/GraphQL now (JSON-RPC was switched off),
 * so this uses the gRPC client and decodes events from BCS, which is the same
 * on every API.
 */

type Network = "testnet" | "devnet" | "mainnet";

export const sui = {
  network: (process.env.NEXT_PUBLIC_SUI_NETWORK ?? "testnet") as Network,
  packageId: process.env.NEXT_PUBLIC_SUI_PACKAGE_ID ?? "",
  vaultId: process.env.NEXT_PUBLIC_SUI_VAULT_ID ?? "",
  adminCapId: process.env.SUI_ADMIN_CAP_ID ?? "",
  adminKey: process.env.SUI_ADMIN_KEY ?? "",
  stakeMist: BigInt(Math.round(Number(process.env.NEXT_PUBLIC_STAKE_SUI ?? "1") * 1e9)),
  feeMist: BigInt(Math.round(Number(process.env.NEXT_PUBLIC_FEE_SUI ?? "0.5") * 1e9)),
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

const client = new SuiGrpcClient({ network: sui.network, baseUrl: `https://fullnode.${sui.network}.sui.io:443` });

/** The on-chain key for a stake or royalty: the approval/submission id as bytes. */
export function keyBytes(id: string) {
  return Array.from(new TextEncoder().encode(id));
}

// Event layouts, mirroring move/vtec/sources/vault.move.
const Staked = bcs.struct("Staked", { submission: bcs.vector(bcs.u8()), owner: bcs.Address, amount: bcs.u64() });
const RoyaltyPaid = bcs.struct("RoyaltyPaid", {
  submission: bcs.vector(bcs.u8()),
  payer: bcs.Address,
  tuner: bcs.Address,
  amount: bcs.u64(),
});
const VerifierDraw = bcs.struct("VerifierDraw", { submission: bcs.vector(bcs.u8()), seed: bcs.u256() });
const FeePaid = bcs.struct("FeePaid", { submission: bcs.vector(bcs.u8()), payer: bcs.Address, amount: bcs.u64() });

const sameBytes = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

type Events = { eventType: string; bcs: Uint8Array }[];

function decode<T>(events: Events, name: string, layout: { parse: (b: Uint8Array) => T }): T[] {
  return events.filter((e) => e.eventType === `${sui.packageId}::vault::${name}`).map((e) => layout.parse(e.bcs));
}

async function eventsOf(digest: string): Promise<Events> {
  const res = await client.waitForTransaction({ digest, include: { events: true }, timeout: 30_000 });
  const tx = res.Transaction ?? res.FailedTransaction;
  if (!res.Transaction || !tx?.status.success) throw new Error("Transaction failed on-chain.");
  return (tx.events ?? []) as Events;
}

/** Checks a Staked event for this key with the full stake amount. */
export async function checkStake(digest: string, key: string) {
  const stake = decode(await eventsOf(digest), "Staked", Staked).find(
    (e) => sameBytes(e.submission, keyBytes(key)) && BigInt(e.amount) >= sui.stakeMist,
  );
  if (!stake) throw new Error("No matching stake in that transaction.");
  return { owner: stake.owner, amountMist: String(stake.amount) };
}

/** Checks a FeePaid event for this approval with the full process fee. */
export async function checkFee(digest: string, key: string) {
  const fee = decode(await eventsOf(digest), "FeePaid", FeePaid).find(
    (e) => sameBytes(e.submission, keyBytes(key)) && BigInt(e.amount) >= sui.feeMist,
  );
  if (!fee) throw new Error("No matching fee payment in that transaction.");
  return { payer: fee.payer, amountMist: String(fee.amount) };
}

/** Checks a RoyaltyPaid event for this submission, paid to the right tuner. */
export async function checkRoyalty(digest: string, submissionId: string, tuner: string, minMist: bigint) {
  const paid = decode(await eventsOf(digest), "RoyaltyPaid", RoyaltyPaid).find(
    (e) => sameBytes(e.submission, keyBytes(submissionId)) && sameAddress(e.tuner, tuner) && BigInt(e.amount) >= minMist,
  );
  if (!paid) throw new Error("No matching royalty payment in that transaction.");
  return { payer: paid.payer, amountMist: String(paid.amount) };
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
  const res = await client.signAndExecuteTransaction({ transaction: tx, signer: admin(), include: { events: true } });
  if (!res.Transaction) {
    throw new Error(res.FailedTransaction?.status.error?.message ?? "Admin transaction failed.");
  }
  await client.waitForTransaction({ digest: res.Transaction.digest });
  return { digest: res.Transaction.digest, events: (res.Transaction.events ?? []) as Events };
}

/** Draws a random seed on-chain for picking this submission's verifiers. */
export async function drawSeed(submissionId: string) {
  const res = await run((tx) =>
    tx.moveCall({
      target: `${sui.packageId}::vault::draw`,
      arguments: [tx.object("0x8"), tx.pure.vector("u8", keyBytes(submissionId))],
    }),
  );
  const draw = decode(res.events, "VerifierDraw", VerifierDraw)[0];
  if (!draw) throw new Error("Draw returned no seed.");
  return { seed: String(draw.seed), digest: res.digest };
}

/** The platform wallet: receives the platform harness's share of fees. */
export function adminAddress() {
  return admin().toSuiAddress();
}

/** Splits a paid fee evenly between the verifiers who ran the check. */
export function distributeFee(key: string, recipients: string[]) {
  return run((tx) =>
    tx.moveCall({
      target: `${sui.packageId}::vault::distribute_fee`,
      arguments: [
        tx.object(sui.adminCapId),
        tx.object(sui.vaultId),
        tx.pure.vector("u8", keyBytes(key)),
        tx.pure.vector("address", recipients),
      ],
    }),
  );
}

/** Nobody could verify it: the fee goes back to whoever paid. */
export function refundFee(key: string) {
  return run((tx) =>
    tx.moveCall({
      target: `${sui.packageId}::vault::refund_fee`,
      arguments: [tx.object(sui.adminCapId), tx.object(sui.vaultId), tx.pure.vector("u8", keyBytes(key))],
    }),
  );
}

export function settleStake(key: string, outcome: "release" | "forfeit") {
  return run((tx) =>
    tx.moveCall({
      target: `${sui.packageId}::vault::${outcome}`,
      arguments: [tx.object(sui.adminCapId), tx.object(sui.vaultId), tx.pure.vector("u8", keyBytes(key))],
    }),
  );
}
