import "server-only";
import { bcs } from "@mysten/sui/bcs";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { verifyPersonalMessageSignature } from "@mysten/sui/verify";

/**
 * Sui testnet, package `vtec` (move/vtec):
 *   human  - HumanPass, minted after a World ID proof (World -> Sui)
 *   vault  - 0.01 SUI process fee per submission, split between verifiers;
 *            on-chain random seed for drawing verifiers
 *   market - Listing per verified kernel; `buy` = pay + split + License
 *
 * The server never trusts a digest or claim from a browser: it reads the
 * transaction or object from the chain. Public fullnodes only speak gRPC, and
 * objects/events are decoded from BCS, which is the same on every API.
 */

type Network = "testnet" | "devnet" | "mainnet";

export const sui = {
  network: (process.env.NEXT_PUBLIC_SUI_NETWORK ?? "testnet") as Network,
  packageId: process.env.NEXT_PUBLIC_SUI_PACKAGE_ID ?? "",
  vaultId: process.env.NEXT_PUBLIC_SUI_VAULT_ID ?? "",
  marketId: process.env.NEXT_PUBLIC_SUI_MARKET_ID ?? "",
  humansId: process.env.SUI_HUMANS_ID ?? "",
  adminCapId: process.env.SUI_ADMIN_CAP_ID ?? "",
  adminKey: process.env.SUI_ADMIN_KEY ?? "",
  feeMist: BigInt(Math.round(Number(process.env.NEXT_PUBLIC_FEE_SUI ?? "0.01") * 1e9)),
  priceMist: BigInt(Math.round(Number(process.env.NEXT_PUBLIC_LICENSE_SUI ?? "0.1") * 1e9)),
};

export function adminReady() {
  return !!(sui.adminCapId && sui.adminKey && sui.packageId && sui.vaultId && sui.humansId);
}

const client = new SuiGrpcClient({ network: sui.network, baseUrl: `https://fullnode.${sui.network}.sui.io:443` });

/** On-chain keys (fees, listings, licenses) are ids as UTF-8 bytes. */
export function keyBytes(id: string) {
  return Array.from(new TextEncoder().encode(id));
}
const text = (bytes: number[]) => new TextDecoder().decode(new Uint8Array(bytes));

// Layouts mirroring move/vtec/sources.
const FeePaid = bcs.struct("FeePaid", { submission: bcs.vector(bcs.u8()), payer: bcs.Address, amount: bcs.u64() });
const VerifierDraw = bcs.struct("VerifierDraw", { submission: bcs.vector(bcs.u8()), seed: bcs.u256() });
const Listed = bcs.struct("Listed", {
  listing: bcs.Address,
  challenge: bcs.vector(bcs.u8()),
  kernel: bcs.vector(bcs.u8()),
  tuner: bcs.Address,
  price: bcs.u64(),
});
const License = bcs.struct("License", {
  id: bcs.Address,
  listing: bcs.Address,
  challenge: bcs.vector(bcs.u8()),
  kernel: bcs.vector(bcs.u8()),
  version: bcs.vector(bcs.u8()),
  expires_ms: bcs.u64(),
});

const sameBytes = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);

type Events = { eventType: string; bcs: Uint8Array }[];

function decode<T>(events: Events, event: string, layout: { parse: (b: Uint8Array) => T }): T[] {
  return events.filter((e) => e.eventType === `${sui.packageId}::${event}`).map((e) => layout.parse(e.bcs));
}

async function eventsOf(digest: string): Promise<Events> {
  const res = await client.waitForTransaction({ digest, include: { events: true }, timeout: 30_000 });
  if (!res.Transaction?.status.success) throw new Error("Transaction failed on-chain.");
  return (res.Transaction.events ?? []) as Events;
}

/* -------------------------------------------------------------------------- */
/* Checks on what users did                                                    */
/* -------------------------------------------------------------------------- */

/** A FeePaid event for this approval with the full process fee. */
export async function checkFee(digest: string, key: string) {
  const fee = decode(await eventsOf(digest), "vault::FeePaid", FeePaid).find(
    (e) => sameBytes(e.submission, keyBytes(key)) && BigInt(e.amount) >= sui.feeMist,
  );
  if (!fee) throw new Error("No matching fee payment in that transaction.");
  return { payer: fee.payer, amountMist: String(fee.amount) };
}

/** The HumanPass this address holds, if any (proof it passed World ID). */
export async function findHumanPass(address: string) {
  const res = await client.listOwnedObjects({ owner: address, type: `${sui.packageId}::human::HumanPass`, limit: 1 });
  return res.objects[0]?.objectId ?? null;
}

/** An unexpired License for this kernel owned by this address. */
export async function findLicense(address: string, submissionId: string) {
  let cursor: string | null = null;
  do {
    const res: { objects: { objectId: string; content: Uint8Array }[]; hasNextPage: boolean; cursor: string | null } =
      await client.listOwnedObjects({
      owner: address,
      type: `${sui.packageId}::market::License`,
      include: { content: true },
      cursor,
    });
    for (const obj of res.objects) {
      const l = License.parse(obj.content);
      if (text(l.kernel) === submissionId && BigInt(l.expires_ms) > BigInt(Date.now())) {
        return { licenseId: obj.objectId, expiresMs: Number(l.expires_ms), challenge: text(l.challenge) };
      }
    }
    cursor = res.hasNextPage ? res.cursor : null;
  } while (cursor);
  return null;
}

/** The wallet really signed this message (Sui personal-message signature). */
export async function checkSignature(message: string, signature: string, address: string) {
  try {
    await verifyPersonalMessageSignature(new TextEncoder().encode(message), signature, { address });
    return true;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Admin actions (server key)                                                  */
/* -------------------------------------------------------------------------- */

function admin() {
  const { secretKey } = decodeSuiPrivateKey(sui.adminKey);
  return Ed25519Keypair.fromSecretKey(secretKey);
}

/** The platform wallet: receives the platform harness's share of fees. */
export function adminAddress() {
  return admin().toSuiAddress();
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

/** World ID verified: give this address its (non-transferable) HumanPass. */
export function mintHumanPass(holder: string, nullifier: string) {
  return run((tx) =>
    tx.moveCall({
      target: `${sui.packageId}::human::mint`,
      arguments: [
        tx.object(sui.adminCapId),
        tx.object(sui.humansId),
        tx.pure.address(holder),
        tx.pure.vector("u8", keyBytes(nullifier)),
      ],
    }),
  );
}

/** Draws a random seed on-chain for picking this submission's verifiers. */
export async function drawSeed(submissionId: string) {
  const res = await run((tx) =>
    tx.moveCall({
      target: `${sui.packageId}::vault::draw`,
      arguments: [tx.object("0x8"), tx.pure.vector("u8", keyBytes(submissionId))],
    }),
  );
  const draw = decode(res.events, "vault::VerifierDraw", VerifierDraw)[0];
  if (!draw) throw new Error("Draw returned no seed.");
  return { seed: String(draw.seed), digest: res.digest };
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

/** A verified kernel goes on sale. Returns the shared Listing's id. */
export async function listKernel(input: {
  challenge: string;
  kernel: string;
  version: string;
  tuner: string;
  lineage: string;
}) {
  const res = await run((tx) =>
    tx.moveCall({
      target: `${sui.packageId}::market::list`,
      arguments: [
        tx.object(sui.adminCapId),
        tx.pure.vector("u8", keyBytes(input.challenge)),
        tx.pure.vector("u8", keyBytes(input.kernel)),
        tx.pure.vector("u8", keyBytes(input.version)),
        tx.pure.address(input.tuner),
        tx.pure.address(input.lineage),
        tx.pure.u64(sui.priceMist),
      ],
    }),
  );
  const listed = decode(res.events, "market::Listed", Listed)[0];
  if (!listed) throw new Error("Listing returned no id.");
  return { listingId: listed.listing, digest: res.digest };
}

/** A newer record replaced it: stop sales (existing licenses stay valid). */
export function retireListing(listingId: string) {
  return run((tx) =>
    tx.moveCall({
      target: `${sui.packageId}::market::retire`,
      arguments: [tx.object(sui.adminCapId), tx.object(listingId)],
    }),
  );
}
