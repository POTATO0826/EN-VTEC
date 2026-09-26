/**
 * Publishes move/vtec to Sui testnet with the local Sui CLI (.tools/sui),
 * then writes the package, vault and admin-cap ids and the admin key into
 * .env.local. The key is written straight to the file, never printed.
 *
 *   bun scripts/publish-sui.ts
 *
 * The CLI's active address pays gas and becomes the admin, so fund it first
 * (send ~1 SUI from Slush to the address this prints).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const SUI = path.join(ROOT, ".tools", "sui", process.platform === "win32" ? "sui.exe" : "sui");
const ENV = path.join(ROOT, ".env.local");

function sui(args: string[]) {
  const res = spawnSync(SUI, args, { encoding: "utf8", cwd: ROOT });
  if (res.status !== 0) {
    console.error(res.stderr || res.stdout);
    process.exit(1);
  }
  return res.stdout;
}

if (!existsSync(SUI)) {
  console.error(`Sui CLI not found at ${SUI}.`);
  process.exit(1);
}

const address = sui(["client", "active-address"]).trim();
console.log(`admin / publisher: ${address}`);

// Older CLIs return a list of gas coins; newer ones an object that also counts
// the address balance.
const gas = JSON.parse(sui(["client", "gas", "--json"])) as
  | { mistBalance: string | number }[]
  | { gasCoins: { mistBalance: string | number }[]; addressMistBalance?: string | number };
const balance = Array.isArray(gas)
  ? gas.reduce((n, c) => n + BigInt(c.mistBalance), BigInt(0))
  : BigInt(gas.addressMistBalance ?? 0) + gas.gasCoins.reduce((n, c) => n + BigInt(c.mistBalance), BigInt(0));
console.log(`balance: ${Number(balance) / 1e9} SUI`);
if (balance < BigInt(300_000_000)) {
  console.error(`Needs at least 0.3 SUI for gas. Send some from Slush to ${address} and run this again.`);
  process.exit(1);
}

console.log("publishing move/vtec…");
const result = JSON.parse(
  sui(["client", "publish", path.join("move", "vtec"), "--gas-budget", "300000000", "--json"]),
) as { digest: string; objectChanges: { type: string; packageId?: string; objectType?: string; objectId?: string }[] };

const packageId = result.objectChanges.find((c) => c.type === "published")?.packageId;
const vaultId = result.objectChanges.find((c) => c.objectType?.endsWith("::vault::Vault"))?.objectId;
const adminCapId = result.objectChanges.find((c) => c.objectType?.endsWith("::vault::AdminCap"))?.objectId;
if (!packageId || !vaultId || !adminCapId) {
  console.error("Publish succeeded but ids weren't found in the output.");
  process.exit(1);
}

// The admin key signs release / forfeit / draw on the server.
const exported = JSON.parse(sui(["keytool", "export", "--key-identity", address, "--json"])) as {
  exportedPrivateKey: string;
};

const values: Record<string, string> = {
  NEXT_PUBLIC_SUI_NETWORK: "testnet",
  NEXT_PUBLIC_SUI_PACKAGE_ID: packageId,
  NEXT_PUBLIC_SUI_VAULT_ID: vaultId,
  SUI_ADMIN_CAP_ID: adminCapId,
  SUI_ADMIN_KEY: exported.exportedPrivateKey,
};

let env = existsSync(ENV) ? readFileSync(ENV, "utf8") : "";
for (const [key, value] of Object.entries(values)) {
  const line = `${key}=${value}`;
  env = new RegExp(`^${key}=.*$`, "m").test(env)
    ? env.replace(new RegExp(`^${key}=.*$`, "m"), line)
    : `${env.trimEnd()}\n${line}\n`;
}
writeFileSync(ENV, env);

console.log(`✓ published in ${result.digest}`);
console.log(`  package  ${packageId}`);
console.log(`  vault    ${vaultId}`);
console.log(`  admin    ${adminCapId}`);
console.log("✓ wrote the ids and SUI_ADMIN_KEY to .env.local");
