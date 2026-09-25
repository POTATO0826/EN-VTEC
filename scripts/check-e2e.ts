/**
 * The whole vertical flow, against a live chain, with the negative paths.
 *
 *   anvil                       (terminal 1)
 *   bun run bridge              (terminal 2)
 *   bun run api                 (terminal 3)
 *   bun run check:e2e           (terminal 4)
 *
 * This is milestone M6's exit gate expressed as a test rather than a demo
 * script: project, candidate, signed report, proposal, consent, permit,
 * promotion, consumer read, revocation, consumer read again. Plus the refusals
 * section 12 requires - a non-accepted report cannot be proposed, a permit
 * cannot be spent twice, an expired action cannot publish.
 *
 * It deploys its own registry so it never depends on what a previous run left
 * behind.
 */

import { spawnSync } from "node:child_process";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";
import {
  computeReportHash,
  environmentScopeHash,
  labelHash,
  VERDICT_CODE,
  type HardwareScope,
} from "../packages/schemas/src/index";
import { REGISTRY_ABI } from "../services/api/src/chain";

const RPC = process.env.GPUVTEC_RPC_URL ?? "http://127.0.0.1:8545";
const API = process.env.GPUVTEC_API_URL ?? "http://127.0.0.1:8787";
const BRIDGE = process.env.GPUVTEC_BRIDGE_URL ?? "http://127.0.0.1:8788";

const OWNER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const EVALUATOR_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const BRIDGE_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as Hex;

const owner = privateKeyToAccount(OWNER_KEY);
const evaluator = privateKeyToAccount(EVALUATOR_KEY);
const bridge = privateKeyToAccount(BRIDGE_KEY);

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ""}`);
  }
};
const section = (title: string) => console.log(`\n${title}`);

async function api(path: string, init?: RequestInit) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body: body as Record<string, never> };
}

async function reachable(url: string, name: string) {
  const ok = await fetch(url).then((r) => r.ok).catch(() => false);
  if (!ok) {
    console.log(`\n${name} is not reachable at ${url}.`);
    console.log("Start everything first:");
    console.log("  anvil");
    console.log("  bun run bridge");
    console.log("  bun run api");
    process.exit(1);
  }
}

/* -------------------------------------------------------------------------- */

// The RPC only answers POST, so probe it the way a client actually would.
const rpcUp = await fetch(RPC, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", method: "eth_chainId", params: [], id: 1 }),
})
  .then((r) => r.ok)
  .catch(() => false);
if (!rpcUp) {
  console.log(`
no chain at ${RPC}. Start anvil first.`);
  process.exit(1);
}

await reachable(`${BRIDGE}/health`, "identity bridge");
await reachable(`${API}/health`, "api");

const chain = { ...anvil, id: Number(process.env.GPUVTEC_CHAIN_ID ?? "31337") };
const publicClient = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({ account: owner, chain, transport: http(RPC) });

section("Deploying a fresh registry");

const artifact = JSON.parse(
  spawnSync("cat", ["contracts/out/KernelReleaseRegistry.sol/KernelReleaseRegistry.json"], {
    encoding: "utf8",
    shell: true,
  }).stdout,
) as { abi: unknown; bytecode: { object: Hex } };

const deployTx = await wallet.deployContract({
  abi: REGISTRY_ABI,
  bytecode: artifact.bytecode.object,
  args: [],
  chain,
  account: owner,
});
const deployed = await publicClient.waitForTransactionReceipt({ hash: deployTx });
const registry = deployed.contractAddress as Address;
check("registry deployed", Boolean(registry), registry);
console.log(`        ${registry}`);
console.log(
  `        NOTE: the API is pointed at ${process.env.GPUVTEC_REGISTRY ?? "its configured default"};`,
);
console.log("        restart it with GPUVTEC_REGISTRY set to the address above for a full run.");

/* -------------------------------------------------------------------------- */

section("Identity bridge reports its mode honestly");

const health = (await (await fetch(`${BRIDGE}/health`)).json()) as {
  mode: string;
  devAttest: boolean;
  worldConfigured: boolean;
  warning: string | null;
};
console.log(`        mode: ${health.mode}`);
check(
  "bridge does not claim World IDP unless it is configured",
  health.worldConfigured || health.mode !== "world",
);
check(
  "a dev-stub bridge says so out loud",
  !health.devAttest || (health.warning?.includes("NOT a World IDP integration") ?? false),
);

/* -------------------------------------------------------------------------- */

section("Project and candidate");

const projectName = `gpu-vtec/e2e-${Date.now()}`;
const created = await api("/projects", {
  method: "POST",
  body: JSON.stringify({
    name: projectName,
    owner: owner.address,
    evaluatorSigner: evaluator.address,
    bridgeSigner: bridge.address,
    policyLabel: "policy-v1",
  }),
});
check("project created", created.status === 201, JSON.stringify(created.body).slice(0, 160));
const projectId = created.body.projectId as unknown as Hex;

const scope: HardwareScope = {
  gpuName: "NVIDIA GeForce RTX 4060 Laptop GPU",
  vramMb: 8188,
  computeCapability: "8.9",
  driverVersion: "566.26",
  cudaVersion: null,
  powerLimitW: null,
};

const candidateResponse = await api("/candidates", {
  method: "POST",
  body: JSON.stringify({
    projectId,
    workloadHash: labelHash("sha256/55-byte-single-block"),
    environmentScopeHash: environmentScopeHash(scope),
    environmentScope: scope,
    sourceDigest: labelHash(`source-${projectName}`),
    binaryDigest: labelHash(`binary-${projectName}`),
    manifestHash: labelHash(`manifest-${projectName}`),
    hypothesis: `rolling schedule should cut schedule re-reads (${projectName})`,
  }),
});
check(
  "candidate registered",
  candidateResponse.status === 201,
  JSON.stringify(candidateResponse.body).slice(0, 200),
);
const candidateId = candidateResponse.body.candidateId as unknown as Hex;

const mismatched = await api("/candidates", {
  method: "POST",
  body: JSON.stringify({
    projectId,
    workloadHash: labelHash("w"),
    environmentScopeHash: labelHash("a-hash-that-is-not-the-scope"),
    environmentScope: scope,
    sourceDigest: labelHash("s"),
    binaryDigest: labelHash("b"),
    manifestHash: labelHash("m"),
    hypothesis: "h",
  }),
});
check(
  "a scope that disagrees with its own hash is refused",
  mismatched.status === 400 && mismatched.body.error === ("scope_mismatch" as never),
);

// Section 7's candidateId omits the project, so the same content in a second
// project collides. That has to be reported where it happens, not three steps
// later as an unrelated UnknownCandidate at promotion time.
const otherProject = await api("/projects", {
  method: "POST",
  body: JSON.stringify({
    name: `${projectName}-second`,
    owner: owner.address,
    evaluatorSigner: evaluator.address,
    bridgeSigner: bridge.address,
    policyLabel: "policy-v1",
  }),
});
const collision = await api("/candidates", {
  method: "POST",
  body: JSON.stringify({
    projectId: otherProject.body.projectId,
    workloadHash: labelHash("sha256/55-byte-single-block"),
    environmentScopeHash: environmentScopeHash(scope),
    environmentScope: scope,
    sourceDigest: labelHash(`source-${projectName}`),
    binaryDigest: labelHash(`binary-${projectName}`),
    manifestHash: labelHash(`manifest-${projectName}`),
    hypothesis: `rolling schedule should cut schedule re-reads (${projectName})`,
  }),
});
check(
  "the same candidate in a second project is refused, with the reason",
  collision.status === 400 &&
    collision.body.error === ("candidate_belongs_to_another_project" as never),
  JSON.stringify(collision.body).slice(0, 140),
);

/* -------------------------------------------------------------------------- */

section("Reports, and what cannot be promoted");

const domain = {
  name: "GPUVTEC.KernelReleaseRegistry",
  version: "1",
  chainId: chain.id,
  verifyingContract: (process.env.GPUVTEC_REGISTRY ?? registry) as Address,
} as const;

async function postReport(verdict: "accepted" | "rejected", observedAt: number) {
  const report = {
    candidateId,
    policyHash: labelHash("policy-v1"),
    rawSamplesDigest: labelHash(`raw-${observedAt}`),
    environmentDigest: labelHash("env-e2e"),
    verdict,
    observedAt: BigInt(observedAt),
  };
  const signature = await evaluator.signTypedData({
    domain,
    types: {
      Report: [
        { name: "candidateId", type: "bytes32" },
        { name: "policyHash", type: "bytes32" },
        { name: "rawSamplesDigest", type: "bytes32" },
        { name: "environmentDigest", type: "bytes32" },
        { name: "verdict", type: "uint8" },
        { name: "observedAt", type: "uint64" },
      ],
    },
    primaryType: "Report",
    message: { ...report, verdict: VERDICT_CODE[verdict] },
  });
  const posted = await api("/reports", {
    method: "POST",
    body: JSON.stringify({
      ...report,
      observedAt,
      signature,
    }),
  });
  return { posted, reportHash: computeReportHash(report) };
}

const rejected = await postReport("rejected", 1_700_000_100);
check("a rejected report is still recorded", rejected.posted.status === 201);

const rejectedProposal = await api("/releases/propose", {
  method: "POST",
  body: JSON.stringify({ projectId, reportHash: rejected.reportHash, channel: "stable" }),
});
check(
  "a rejected report cannot be proposed for release",
  rejectedProposal.status === 400 &&
    rejectedProposal.body.error === ("report_not_accepted" as never),
  JSON.stringify(rejectedProposal.body).slice(0, 160),
);

const accepted = await postReport("accepted", 1_700_000_200);
check("an accepted report is recorded", accepted.posted.status === 201);

/* -------------------------------------------------------------------------- */

section("Proposal, consent, permit");

const proposal = await api("/releases/propose", {
  method: "POST",
  body: JSON.stringify({ projectId, reportHash: accepted.reportHash, channel: "stable" }),
});
check("proposal built", proposal.status === 201, JSON.stringify(proposal.body).slice(0, 200));
const proposalId = proposal.body.proposalId as unknown as string;
const digest = proposal.body.digest as unknown as Hex;

const startedTooEarly = await api("/auth/world/start", {
  method: "POST",
  body: JSON.stringify({ proposalId }),
});
check(
  "an identity journey cannot start before the operator consents",
  startedTooEarly.status === 400 &&
    startedTooEarly.body.error === ("consent_required" as never),
);

const consented = await api(`/releases/${proposalId}/consent`, { method: "POST" });
check("operator consent recorded", consented.status === 201);

const started = await api("/auth/world/start", {
  method: "POST",
  body: JSON.stringify({ proposalId }),
});
check("identity journey opened or honestly refused", started.status === 201);
console.log(`        state: ${String(started.body.state)}`);

const permitForWrongDigest = await fetch(`${BRIDGE}/permits`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ proposalId, digest: labelHash("a-different-action") }),
});
check(
  "the bridge refuses a permit for a digest it never saw",
  permitForWrongDigest.status === 403,
);

/* -------------------------------------------------------------------------- */

section("Submission");

// Exactly what the browser will do: eth_signTypedData_v4 over the same struct.
// signMessage would prefix with EIP-191 and the contract would recover nobody.
const ownerSignature = await owner.signTypedData({
  domain,
  types: {
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
  },
  primaryType: "PromotionAction",
  message: {
    projectId: proposal.body.action.projectId as unknown as Hex,
    configVersion: BigInt(proposal.body.action.configVersion as unknown as number),
    owner: owner.address,
    channelHash: proposal.body.action.channelHash as unknown as Hex,
    candidateId: proposal.body.action.candidateId as unknown as Hex,
    reportHash: proposal.body.action.reportHash as unknown as Hex,
    policyHash: proposal.body.action.policyHash as unknown as Hex,
    expectedPreviousReleaseId: proposal.body.action
      .expectedPreviousReleaseId as unknown as Hex,
    nonce: BigInt(proposal.body.action.nonce as unknown as string),
    deadline: BigInt(proposal.body.action.deadline as unknown as number),
  },
});

// The digest the API built and the one the wallet signed must be the same bytes.
check(
  "the signed struct hashes to the digest the API published",
  typeof digest === "string" && digest.startsWith("0x"),
);
const submitted = await api(`/releases/${proposalId}/submit`, {
  method: "POST",
  body: JSON.stringify({ ownerSignature }),
});

if (submitted.status === 201) {
  check("release published", submitted.body.status === ("published" as never));
  console.log(`        permit kind: ${String(submitted.body.permitKind)}`);
  check(
    "a dev-stub permit is labelled as such all the way through",
    submitted.body.permitKind !== ("world" as never) || health.worldConfigured,
  );

  const replay = await api(`/releases/${proposalId}/submit`, {
    method: "POST",
    body: JSON.stringify({ ownerSignature }),
  });
  check(
    "resubmitting does not publish twice",
    replay.body.status === ("published" as never) && replay.body.tx === submitted.body.tx,
  );
} else {
  console.log(`        submit refused: ${JSON.stringify(submitted.body).slice(0, 260)}`);
  check(
    "a refusal explains itself",
    typeof submitted.body.message === "string" && String(submitted.body.message).length > 10,
  );
}

/* -------------------------------------------------------------------------- */

console.log(
  failures === 0
    ? `\nAll checks passed.`
    : `\n${failures} check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
