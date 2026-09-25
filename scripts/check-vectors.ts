/**
 * Milestone M5's exit gate, in one command.
 *
 *   bun run check:vectors
 *
 * Build plan section 7: "Publish shared test vectors that Python, TypeScript,
 * and Solidity all pass." This runs all three against
 * packages/schemas/vectors.json and fails if any of them disagrees.
 *
 * Why it matters: a candidate id computed one way in the evaluator and another
 * way in the API means the report is signed over an artifact the contract has
 * never heard of. That failure is silent everywhere except here.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import {
  SCHEMA_VERSION,
  canonicalJson,
  computeCandidateId,
  computePromotionStructHash,
  computeReleaseId,
  computeReportHash,
  domainSeparator,
  labelHash,
  manifestKeccak,
  promotionDigest,
  reportDigest,
  typedDataDigest,
  type Hex,
  type Verdict,
} from "../packages/schemas/src/index";

const VECTORS = "packages/schemas/vectors.json";

let failures = 0;

function check(label: string, got: unknown, want: unknown) {
  if (got === want) {
    console.log(`  ok    ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}`);
    console.log(`          got  ${String(got)}`);
    console.log(`          want ${String(want)}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

/* -------------------------------------------------------------------------- */

if (!existsSync(VECTORS)) {
  console.log(`\nmissing ${VECTORS}`);
  console.log("run: bun packages/schemas/scripts/gen-vectors.ts");
  process.exit(1);
}

type Vectors = {
  schemaVersion: number;
  eip712: { chainId: number; verifyingContract: Hex; domainSeparator: Hex };
  labelHash: Record<string, Hex>;
  candidate: { input: Record<string, Hex>; candidateId: Hex };
  report: {
    input: Record<string, string | number>;
    reportHash: Hex;
    digest: Hex;
  };
  promotion: {
    input: Record<string, string | number>;
    structHash: Hex;
    digest: Hex;
  };
  release: { input: Record<string, Hex>; releaseId: Hex };
  canonicalJson: { input: Record<string, unknown>; encoded: string; keccak: Hex };
};

const v = JSON.parse(readFileSync(VECTORS, "utf8")) as Vectors;
const chainId = BigInt(v.eip712.chainId);
const contract = v.eip712.verifyingContract;

section("TypeScript");

check("schemaVersion", Number(SCHEMA_VERSION), v.schemaVersion);

for (const [label, want] of Object.entries(v.labelHash)) {
  check(`labelHash("${label}")`, labelHash(label), want);
}

check("domainSeparator", domainSeparator(chainId, contract), v.eip712.domainSeparator);

const ci = v.candidate.input;
check(
  "computeCandidateId",
  computeCandidateId({
    parentId: ci.parentId,
    workloadHash: ci.workloadHash,
    environmentScopeHash: ci.environmentScopeHash,
    sourceDigest: ci.sourceDigest,
    binaryDigest: ci.binaryDigest,
    hypothesisHash: ci.hypothesisHash,
  }),
  v.candidate.candidateId,
);

const ri = v.report.input;
const report = {
  candidateId: ri.candidateId as Hex,
  policyHash: ri.policyHash as Hex,
  rawSamplesDigest: ri.rawSamplesDigest as Hex,
  environmentDigest: ri.environmentDigest as Hex,
  verdict: ri.verdict as Verdict,
  observedAt: BigInt(ri.observedAt as number),
};
check("computeReportHash", computeReportHash(report), v.report.reportHash);
check("reportDigest", reportDigest(report, chainId, contract), v.report.digest);

const pi = v.promotion.input;
const action = {
  projectId: pi.projectId as Hex,
  configVersion: BigInt(pi.configVersion as number),
  owner: pi.owner as Hex,
  channelHash: pi.channelHash as Hex,
  candidateId: pi.candidateId as Hex,
  reportHash: pi.reportHash as Hex,
  policyHash: pi.policyHash as Hex,
  expectedPreviousReleaseId: pi.expectedPreviousReleaseId as Hex,
  nonce: BigInt(pi.nonce as number),
  deadline: BigInt(pi.deadline as number),
};
check("promotion structHash", computePromotionStructHash(action), v.promotion.structHash);
check("promotion digest", promotionDigest(action, chainId, contract), v.promotion.digest);
check(
  "digest == typedDataDigest(domainSeparator, structHash)",
  typedDataDigest(v.eip712.domainSeparator, v.promotion.structHash),
  v.promotion.digest,
);

const rel = v.release.input;
check(
  "computeReleaseId",
  computeReleaseId({
    projectId: rel.projectId,
    channelHash: rel.channelHash,
    candidateId: rel.candidateId,
    reportHash: rel.reportHash,
    previousReleaseId: rel.previousReleaseId,
  }),
  v.release.releaseId,
);

check("canonical JSON encoding", canonicalJson(v.canonicalJson.input as never), v.canonicalJson.encoded);
check("canonical JSON keccak", manifestKeccak(v.canonicalJson.input as never), v.canonicalJson.keccak);

/* -------------------------------------------------------------------------- */

section("Python");

const python = spawnSync(
  process.platform === "win32" ? "python" : "python3",
  ["packages/schemas/python/check_vectors.py"],
  { encoding: "utf8" },
);

if (python.error) {
  failures += 1;
  console.log(`  FAIL  could not run python - ${python.error.message}`);
} else {
  const lines = (python.stdout ?? "").trimEnd().split("\n");
  const summary = lines[lines.length - 1] ?? "";
  if (python.status === 0) {
    console.log(`  ok    ${summary.trim()}`);
  } else {
    failures += 1;
    for (const line of lines.filter((l) => l.includes("FAIL") || l.includes("got") || l.includes("want"))) {
      console.log(`  ${line.trim()}`);
    }
    console.log(`  FAIL  ${summary.trim()}`);
  }
}

/* -------------------------------------------------------------------------- */

section("Solidity");

const forge = spawnSync("forge", ["test", "--match-contract", "VectorsTest"], {
  cwd: "contracts",
  encoding: "utf8",
  shell: process.platform === "win32",
});

if (forge.error || forge.status === null) {
  console.log("  skip  forge not on PATH - run `cd contracts && forge test` yourself");
  console.log("        (foundryup installs to ~/.foundry/bin)");
} else if (forge.status === 0) {
  const line = (forge.stdout ?? "").split("\n").find((l) => l.includes("tests passed"));
  console.log(`  ok    ${(line ?? "VectorsTest passed").trim()}`);
} else {
  failures += 1;
  for (const line of (forge.stdout ?? "").split("\n").filter((l) => l.includes("FAIL") || l.includes("assert"))) {
    console.log(`  ${line.trim()}`);
  }
  console.log("  FAIL  Solidity disagrees with the vectors");
}

/* -------------------------------------------------------------------------- */

console.log(
  failures === 0
    ? "\nAll three agree. Milestone M5's gate is met."
    : `\n${failures} check(s) failed. The three implementations do not agree.`,
);
process.exit(failures === 0 ? 0 : 1);
