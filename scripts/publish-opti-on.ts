/**
 * Publishes move/opti_on (stake escrow, settle PTB, #1, royalties) to Sui
 * with the platform wallet (SUI_ADMIN_KEY), so that wallet owns the AdminCap,
 * then opens one Challenge per kernel track and writes the ids to .env.local.
 * Nothing secret is printed.
 *
 *   bun scripts/publish-opti-on.ts
 *
 * Re-running publishes a fresh package (new ids); it doesn't upgrade.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";

const ROOT = path.resolve(import.meta.dir, "..");
const SUI = path.join(ROOT, ".tools", "sui", process.platform === "win32" ? "sui.exe" : "sui");
const ENV = path.join(ROOT, ".env.local");
const PACKAGE = path.join(ROOT, "move", "opti_on");

/** One challenge per kernel track: [track id, task, GPU]. */
const CHALLENGES: [string, string, string][] = [["rmsnorm-4096", "RMSNorm 8192x4096 fp32", "NVIDIA GPU"]];
const mist = (sui: string | undefined, fallback: string) => BigInt(Math.round(Number(sui ?? fallback) * 1e9));
const PRICE = mist(process.env.NEXT_PUBLIC_LICENSE_SUI, "0.1");
const STAKE = mist(process.env.NEXT_PUBLIC_STAKE_SUI, "0.0001");
const FEE_BPS = 250; // Opti-On keeps 2.5% of each sale

if (!existsSync(SUI)) throw new Error(`Sui CLI not found at ${SUI}.`);
if (!process.env.SUI_ADMIN_KEY) throw new Error("SUI_ADMIN_KEY missing from .env.local.");
const network = (process.env.NEXT_PUBLIC_SUI_NETWORK ?? "testnet") as "testnet" | "devnet" | "mainnet";
const client = new SuiGrpcClient({ network, baseUrl: `https://fullnode.${network}.sui.io:443` });
const admin = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(process.env.SUI_ADMIN_KEY).secretKey);
const adminAddress = admin.toSuiAddress();
console.log(`publisher (gets the AdminCap): ${adminAddress} on ${network}`);

async function send(tx: Transaction, label: string) {
  const res = await client.signAndExecuteTransaction({
    signer: admin,
    transaction: tx,
    include: { effects: true, objectTypes: true },
  });
  const t = res.Transaction ?? res.FailedTransaction!;
  if (!t.status.success) throw new Error(`${label} failed: ${t.status.error?.message}`);
  await client.waitForTransaction({ digest: t.digest });
  console.log(`✓ ${label}: https://suiscan.xyz/${network}/tx/${t.digest}`);
  return t;
}
const created = (t: Awaited<ReturnType<typeof send>>, suffix: string) =>
  t.effects!.changedObjects.find((o) => o.idOperation === "Created" && t.objectTypes?.[o.objectId]?.endsWith(suffix))?.objectId;

// 1. Build and publish (run `sui move test --path move/opti_on` for the tests).
const built = spawnSync(SUI, ["move", "build", "--dump-bytecode-as-base64", "--path", PACKAGE], { encoding: "utf8", cwd: ROOT });
if (built.status !== 0) throw new Error(built.stderr || built.stdout);
const { modules, dependencies } = JSON.parse(built.stdout.slice(built.stdout.indexOf("{"))) as { modules: string[]; dependencies: string[] };

const publishTx = new Transaction();
const upgradeCap = publishTx.publish({ modules, dependencies });
publishTx.transferObjects([upgradeCap], adminAddress);
const published = await send(publishTx, "publish opti_on");
const adminCapId = created(published, "::market::AdminCap");
// The AdminCap's type is <package>::market::AdminCap.
const packageId = adminCapId ? published.objectTypes?.[adminCapId]?.split("::")[0] : undefined;
if (!packageId || !adminCapId) throw new Error("Couldn't find the package id or the AdminCap in the publish result.");
console.log(`  package ${packageId}\n  AdminCap ${adminCapId}`);

// 2. One Challenge per track.
const challenges: Record<string, string> = {};
for (const [track, task, gpu] of CHALLENGES) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${packageId}::market::create_challenge`,
    arguments: [tx.object(adminCapId), tx.pure.string(task), tx.pure.string(gpu), tx.pure.u64(PRICE), tx.pure.u64(FEE_BPS), tx.pure.u64(STAKE)],
  });
  const t = await send(tx, `open challenge ${track} (stake ${Number(STAKE) / 1e9} SUI)`);
  const id = created(t, "::market::Challenge");
  if (!id) throw new Error(`No Challenge created for ${track}.`);
  challenges[track] = id;
  console.log(`  challenge ${track} = ${id}`);
}

// 3. Write the ids to .env.local (replacing earlier ones).
const values: Record<string, string> = {
  NEXT_PUBLIC_OPTI_ON_PACKAGE_ID: packageId,
  OPTI_ON_ADMIN_CAP_ID: adminCapId,
  NEXT_PUBLIC_OPTI_ON_CHALLENGES: JSON.stringify(challenges),
};
let env = existsSync(ENV) ? readFileSync(ENV, "utf8") : "";
for (const [key, value] of Object.entries(values)) {
  const line = `${key}=${value}`;
  env = new RegExp(`^${key}=.*$`, "m").test(env) ? env.replace(new RegExp(`^${key}=.*$`, "m"), line) : `${env.replace(/\n*$/, "\n")}${line}\n`;
}
writeFileSync(ENV, env);
console.log(`✓ wrote ${Object.keys(values).join(", ")} to .env.local`);
