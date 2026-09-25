/**
 * Deploys KernelReleaseRegistry to a public testnet and walks the real
 * lifecycle on it, so every hash the UI shows is a transaction that actually
 * exists and every "view on Etherscan" link resolves.
 *
 *   bun run deploy:testnet
 *
 * Milestone M9. Build plan section 2 picks Ethereum Sepolia.
 *
 * What it produces, all of it real:
 *
 *   - the registry, deployed
 *   - a project, created onchain
 *   - two candidates, registered
 *   - two evaluator-signed reports: one accepted, one rejected
 *   - a release, promoted with owner + bridge signatures
 *   - a second release, promoted and then revoked
 *
 * Both a live release and a revoked one, because the demo needs to link to each.
 *
 * Idempotent: if src/data/deployment.json already names a registry with code at
 * that address, this reuses it rather than redeploying. Delete the file to start
 * over.
 *
 * It refuses to run against a local chain. Anvil has no block explorer, so a
 * link to one would 404 - which is the exact problem this exists to remove.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import {
  environmentScopeHash,
  labelHash,
  VERDICT_CODE,
  type HardwareScope,
} from "../packages/schemas/src/index";
import { REGISTRY_ABI } from "../services/api/src/chain";

const OUT = "src/data/deployment.json";
const ARTIFACT = "contracts/out/KernelReleaseRegistry.sol/KernelReleaseRegistry.json";

const CHAIN_ID = Number(process.env.GPUVTEC_CHAIN_ID ?? "11155111");
const RPC = process.env.GPUVTEC_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const PROJECT_NAME = process.env.GPUVTEC_PROJECT ?? "gpu-vtec/sha256";
const POLICY_LABEL = "beats-baseline-by-more-than-noise-band/v1";

/** Explorer for the chain we are on. Only chains with a real explorer allowed. */
const EXPLORERS: Record<number, { name: string; base: string }> = {
  11155111: { name: "Etherscan (Sepolia)", base: "https://sepolia.etherscan.io" },
  84532: { name: "Basescan (Base Sepolia)", base: "https://sepolia.basescan.org" },
  1: { name: "Etherscan", base: "https://etherscan.io" },
  8453: { name: "Basescan", base: "https://basescan.org" },
};

/* -------------------------------------------------------------------------- */

function must(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(
      `\nmissing ${name}. It lives in .env.sepolia, which is gitignored.`,
    );
    process.exit(1);
  }
  return value;
}

const explorer = EXPLORERS[CHAIN_ID];
if (!explorer) {
  console.error(
    `\nchain ${CHAIN_ID} has no block explorer in this script's list.\n` +
      "The point of deploying to a testnet is that the links resolve, so a chain\n" +
      "without an explorer is refused rather than half-supported.\n\n" +
      `Supported: ${Object.keys(EXPLORERS).join(", ")}`,
  );
  process.exit(1);
}

const relayer = privateKeyToAccount(must("GPUVTEC_RELAYER_KEY") as Hex);
const evaluator = privateKeyToAccount(must("GPUVTEC_EVALUATOR_KEY") as Hex);
const bridge = privateKeyToAccount(must("GPUVTEC_BRIDGE_KEY") as Hex);

const chain = { ...sepolia, id: CHAIN_ID };
const publicClient = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({ account: relayer, chain, transport: http(RPC) });

const tx = (hash: string) => `${explorer.base}/tx/${hash}`;
const addressUrl = (a: string) => `${explorer.base}/address/${a}`;

let step = 0;
function log(label: string, detail = "") {
  step += 1;
  console.log(`\n${String(step).padStart(2)}. ${label}`);
  if (detail) console.log(`    ${detail}`);
}

async function send(
  functionName: string,
  args: readonly unknown[],
  address: Address,
): Promise<Hex> {
  const { request } = await publicClient.simulateContract({
    address,
    abi: REGISTRY_ABI,
    functionName: functionName as never,
    args: args as never,
    account: relayer,
  });
  const hash = await wallet.writeContract(request as never);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted (${hash})`);
  console.log(`    ${tx(hash)}`);
  return hash;
}

/* -------------------------------------------------------------------------- */

console.log(`\nGPU VTEC - testnet deployment`);
console.log(`  chain     ${CHAIN_ID} (${explorer.name})`);
console.log(`  rpc       ${RPC}`);
console.log(`  relayer   ${relayer.address}`);
console.log(`  evaluator ${evaluator.address}`);
console.log(`  bridge    ${bridge.address}`);

const balance = await publicClient.getBalance({ address: relayer.address });
console.log(`  balance   ${formatEther(balance)} ETH`);

if (balance === 0n) {
  console.error(
    `\nThe relayer has no testnet ETH, so nothing can be deployed.\n\n` +
      `Fund this address with Sepolia ETH:\n\n    ${relayer.address}\n\n` +
      `Faucets:\n` +
      `    https://cloud.google.com/application/web3/faucet/ethereum/sepolia\n` +
      `    https://www.alchemy.com/faucets/ethereum-sepolia\n` +
      `    https://sepolia-faucet.pk910.de\n\n` +
      `About 0.05 ETH is plenty - the whole lifecycle is roughly 3.5M gas.\n` +
      `Then run this again.`,
  );
  process.exit(1);
}

if (balance < 5_000_000_000_000_000n) {
  console.warn(
    `\n  WARNING: under 0.005 ETH. The full lifecycle is roughly 3.5M gas and\n` +
      `  may run out part way. Top up if it fails.`,
  );
}

/* -------------------------------------------------------------------------- */

type Deployment = {
  chainId: number;
  chainName: string;
  explorer: { name: string; base: string };
  registry: Address;
  registryUrl: string;
  deployedAt: string;
  owner: Address;
  evaluator: Address;
  bridge: Address;
  projectId: Hex;
  projectName: string;
  policyHash: Hex;
  channel: string;
  channelHash: Hex;
  transactions: { label: string; hash: Hex; url: string }[];
  /** The release a consumer should adopt. */
  activeRelease: { releaseId: Hex; candidateId: Hex; reportHash: Hex } | null;
  /** A release that was promoted and then revoked, for the fallback demo. */
  revokedRelease: { releaseId: Hex; candidateId: Hex; reportHash: Hex } | null;
};

const transactions: Deployment["transactions"] = [];
const record = (label: string, hash: Hex) =>
  transactions.push({ label, hash, url: tx(hash) });

/* -- 1. the registry --------------------------------------------------- */

let registry: Address | null = null;

if (existsSync(OUT)) {
  const prior = JSON.parse(readFileSync(OUT, "utf8")) as Deployment;
  if (prior.chainId === CHAIN_ID) {
    const code = await publicClient.getCode({ address: prior.registry });
    if (code && code !== "0x") {
      registry = prior.registry;
      log("reusing the existing deployment", `${registry}  ${addressUrl(registry)}`);
      console.log(`    delete ${OUT} to deploy a fresh one`);
    }
  }
}

if (!registry) {
  if (!existsSync(ARTIFACT)) {
    console.error(`\nmissing ${ARTIFACT}. Run: cd contracts && forge build`);
    process.exit(1);
  }
  const artifact = JSON.parse(readFileSync(ARTIFACT, "utf8")) as {
    bytecode: { object: Hex };
  };

  log("deploying KernelReleaseRegistry");
  const hash = await wallet.deployContract({
    abi: REGISTRY_ABI,
    bytecode: artifact.bytecode.object,
    args: [],
    chain,
    account: relayer,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress) {
    throw new Error(`deployment failed (${hash})`);
  }
  registry = receipt.contractAddress;
  record("deploy registry", hash);
  console.log(`    ${registry}`);
  console.log(`    ${addressUrl(registry)}`);
}

/* -- 2. the project ---------------------------------------------------- */

const projectId = labelHash(PROJECT_NAME);
const policyHash = labelHash(POLICY_LABEL);
const channel = "stable";
const channelHash = labelHash(channel);

const existingProject = await publicClient.readContract({
  address: registry,
  abi: REGISTRY_ABI,
  functionName: "getProject",
  args: [projectId],
});

if (existingProject.owner === "0x0000000000000000000000000000000000000000") {
  log("createProject", `${PROJECT_NAME}  owner ${relayer.address}`);
  record(
    "createProject",
    await send(
      "createProject",
      [projectId, relayer.address, evaluator.address, bridge.address, policyHash],
      registry,
    ),
  );
} else {
  log("project already exists onchain", PROJECT_NAME);
}

/* -- 3..n. candidates, reports, releases -------------------------------- */

/** The machine the build plan scopes everything to. */
const scope: HardwareScope = {
  gpuName: "NVIDIA GeForce RTX 4060 Laptop GPU",
  vramMb: 8188,
  computeCapability: "8.9",
  driverVersion: "566.26",
  cudaVersion: null,
  powerLimitW: null,
};
const envScopeHash = environmentScopeHash(scope);
const workloadHash = labelHash("sha256/55-byte-single-block");

/** Unique per deployment, so a re-run cannot collide with an earlier candidate. */
const salt = Date.now().toString(36);

const REPORT_TYPES = {
  Report: [
    { name: "candidateId", type: "bytes32" },
    { name: "policyHash", type: "bytes32" },
    { name: "rawSamplesDigest", type: "bytes32" },
    { name: "environmentDigest", type: "bytes32" },
    { name: "verdict", type: "uint8" },
    { name: "observedAt", type: "uint64" },
  ],
} as const;

const ACTION_TYPES = {
  PromotionAction: [
    { name: "projectId", type: "bytes32" },
    { name: "configVersion", type: "uint64" },
    { name: "owner", type: "address" },
    { name: "channelHash", type: "bytes32" },
    { name: "candidateId", type: "bytes32" },
    { name: "reportHash", type: "bytes32" },
    { name: "policyHash", type: "bytes32" },
    { name: "expectedPreviousReleaseId", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

const domain = {
  name: "GPUVTEC.KernelReleaseRegistry",
  version: "1",
  chainId: CHAIN_ID,
  verifyingContract: registry,
} as const;

async function registerCandidate(tag: string, hypothesis: string): Promise<Hex> {
  const hypothesisHash = labelHash(hypothesis);
  log(`registerCandidate  ${tag}`);
  const hash = await send(
    "registerCandidate",
    [
      projectId,
      "0x0000000000000000000000000000000000000000000000000000000000000000",
      workloadHash,
      envScopeHash,
      labelHash(`source/${tag}/${salt}`),
      labelHash(`binary/${tag}/${salt}`),
      hypothesisHash,
      labelHash(`manifest/${tag}/${salt}`),
    ],
    registry!,
  );
  record(`registerCandidate ${tag}`, hash);

  const { computeCandidateId } = await import("../packages/schemas/src/index");
  return computeCandidateId({
    parentId: "0x0000000000000000000000000000000000000000000000000000000000000000",
    workloadHash,
    environmentScopeHash: envScopeHash,
    sourceDigest: labelHash(`source/${tag}/${salt}`),
    binaryDigest: labelHash(`binary/${tag}/${salt}`),
    hypothesisHash,
  });
}

async function recordReport(
  tag: string,
  candidateId: Hex,
  verdict: "accepted" | "rejected",
): Promise<Hex> {
  const report = {
    candidateId,
    policyHash,
    rawSamplesDigest: labelHash(`samples/${tag}/${salt}`),
    environmentDigest: labelHash(`env/${salt}`),
    verdict,
    observedAt: BigInt(Math.floor(Date.now() / 1000)),
  };

  // The evaluator signs. This key never touches the API or the worker.
  const signature = await evaluator.signTypedData({
    domain,
    types: REPORT_TYPES,
    primaryType: "Report",
    message: { ...report, verdict: VERDICT_CODE[verdict] },
  });

  log(`recordReport  ${tag}  (${verdict})`);
  const hash = await send(
    "recordReport",
    [
      {
        candidateId: report.candidateId,
        policyHash: report.policyHash,
        rawSamplesDigest: report.rawSamplesDigest,
        environmentDigest: report.environmentDigest,
        verdict: VERDICT_CODE[verdict],
        observedAt: report.observedAt,
      },
      signature,
    ],
    registry!,
  );
  record(`recordReport ${tag} (${verdict})`, hash);

  const { computeReportHash } = await import("../packages/schemas/src/index");
  return computeReportHash(report);
}

async function promote(
  tag: string,
  candidateId: Hex,
  reportHash: Hex,
  previous: Hex,
): Promise<Hex> {
  const action = {
    projectId,
    configVersion: 1n,
    owner: relayer.address,
    channelHash,
    candidateId,
    reportHash,
    policyHash,
    expectedPreviousReleaseId: previous,
    nonce: BigInt(Date.now()),
    deadline: BigInt(Math.floor(Date.now() / 1000) + 900),
  };

  // Two independent signatures over the identical struct. In the product these
  // come from the owner's wallet and the identity bridge; here both keys are
  // local because this script is seeding a testnet, and it says so.
  const ownerSignature = await relayer.signTypedData({
    domain,
    types: ACTION_TYPES,
    primaryType: "PromotionAction",
    message: action,
  });
  const bridgeSignature = await bridge.signTypedData({
    domain,
    types: ACTION_TYPES,
    primaryType: "PromotionAction",
    message: action,
  });

  log(`promoteRelease  ${tag}`);
  const hash = await send(
    "promoteRelease",
    [action, ownerSignature, bridgeSignature],
    registry!,
  );
  record(`promoteRelease ${tag}`, hash);

  const [releaseId] = await publicClient.readContract({
    address: registry!,
    abi: REGISTRY_ABI,
    functionName: "getCurrentRelease",
    args: [projectId, channelHash],
  });
  return releaseId;
}

// A release that gets revoked, so the consumer's fallback has something real to
// point at, and the demo can link to a genuine revocation.
const firstCandidate = await registerCandidate("rolling", "16-word rolling window, fully unrolled");
const firstReport = await recordReport("rolling", firstCandidate, "accepted");
const firstRelease = await promote(
  "rolling",
  firstCandidate,
  firstReport,
  "0x0000000000000000000000000000000000000000000000000000000000000000",
);

log("revokeRelease  rolling", "so the fallback path has a real transaction to show");
record(
  "revokeRelease rolling",
  await send(
    "revokeRelease",
    [firstRelease, labelHash("superseded by shared-K at 1,048,576 messages")],
    registry,
  ),
);

// A rejected report, recorded and never promoted. The failures have to be
// visible onchain too, not just in the UI.
const rejectedCandidate = await registerCandidate(
  "mpt4",
  "four messages per thread; highest register use",
);
await recordReport("mpt4", rejectedCandidate, "rejected");

// The release that stays live.
const secondCandidate = await registerCandidate(
  "sharedk",
  "constant table staged in shared memory, 128-thread blocks",
);
const secondReport = await recordReport("sharedk", secondCandidate, "accepted");
const secondRelease = await promote("sharedk", secondCandidate, secondReport, firstRelease);

/* -------------------------------------------------------------------------- */

const deployment: Deployment = {
  chainId: CHAIN_ID,
  chainName: CHAIN_ID === 11155111 ? "Sepolia" : String(CHAIN_ID),
  explorer,
  registry,
  registryUrl: addressUrl(registry),
  deployedAt: new Date().toISOString(),
  owner: relayer.address,
  evaluator: evaluator.address,
  bridge: bridge.address,
  projectId,
  projectName: PROJECT_NAME,
  policyHash,
  channel,
  channelHash,
  transactions,
  activeRelease: {
    releaseId: secondRelease,
    candidateId: secondCandidate,
    reportHash: secondReport,
  },
  revokedRelease: {
    releaseId: firstRelease,
    candidateId: firstCandidate,
    reportHash: firstReport,
  },
};

writeFileSync(OUT, `${JSON.stringify(deployment, null, 2)}\n`);

console.log(`\n${"=".repeat(70)}`);
console.log(`wrote ${OUT}`);
console.log(`\nregistry   ${addressUrl(registry)}`);
console.log(`\n${transactions.length} transactions, all real, all linkable:`);
for (const entry of transactions) {
  console.log(`  ${entry.label.padEnd(32)} ${entry.url}`);
}
console.log(
  `\nSet this in .env so the API and consumer use the same deployment:\n` +
    `  GPUVTEC_REGISTRY=${registry}\n`,
);
/* -------------------------------------------------------------------------- */
/* Source verification                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Verify the source on the explorer, automatically, when a key is present.
 *
 * This is the difference between a judge clicking through to readable Solidity
 * and clicking through to a wall of bytecode. It is not optional in spirit - it
 * is only optional because it needs a free API key - so it runs on its own
 * rather than being a command printed at the end for someone to remember.
 *
 * Already-verified is treated as success: re-running the deploy against an
 * existing registry should not report a failure for work that is already done.
 */
const etherscanKey = process.env.ETHERSCAN_API_KEY?.trim();

if (!etherscanKey) {
  console.log(
    "\nSource NOT verified - no ETHERSCAN_API_KEY in .env.sepolia.\n" +
      "  The explorer will show bytecode instead of Solidity, which is a much\n" +
      "  weaker thing for anyone to check. A free key takes a minute:\n" +
      "    https://etherscan.io/myapikey\n" +
      "  Then re-run this script; it reuses the deployment and just verifies.\n",
  );
} else {
  console.log(`\nVerifying the source on ${explorer.name}...`);

  const result = Bun.spawnSync({
    cmd: [
      "forge",
      "verify-contract",
      registry,
      "src/KernelReleaseRegistry.sol:KernelReleaseRegistry",
      "--chain",
      String(CHAIN_ID),
      "--etherscan-api-key",
      etherscanKey,
      "--watch",
    ],
    cwd: "contracts",
    stdout: "pipe",
    stderr: "pipe",
  });

  const output = `${result.stdout.toString()}${result.stderr.toString()}`;
  const alreadyDone = /already verified/i.test(output);

  if (result.exitCode === 0 || alreadyDone) {
    console.log(
      alreadyDone
        ? `  already verified`
        : `  verified - the explorer now shows the Solidity source`,
    );
    console.log(`  ${addressUrl(registry)}#code`);
  } else {
    // Not fatal. The deployment is real and every transaction link works; only
    // the source view is missing, and saying which is more useful than failing.
    console.warn(`  verification failed (exit ${result.exitCode})`);
    console.warn(
      output
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .slice(-6)
        .map((line) => `    ${line.trim()}`)
        .join("\n"),
    );
    console.warn(
      "\n  The deployment itself is fine - every transaction above resolves.\n" +
        "  Only the source view is missing. Re-run to retry just the verify.",
    );
  }
}

console.log(
  "\nSet this in .env.sepolia so re-runs reuse the same registry:\n" +
    `  GPUVTEC_REGISTRY=${registry}\n`,
);
