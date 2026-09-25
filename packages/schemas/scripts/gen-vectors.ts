/**
 * Generates the shared test vectors that Python, TypeScript and Solidity are all
 * checked against. Milestone M5's exit gate.
 *
 *   bun packages/schemas/scripts/gen-vectors.ts
 *
 * TypeScript is the generator only because something has to be. It is not the
 * authority: if the three implementations disagree, the disagreement is the
 * finding, and the fix is to work out which one has the encoding wrong rather
 * than to regenerate until everyone matches whoever ran last.
 *
 * Regenerate only when the encoding deliberately changes, and bump
 * SCHEMA_VERSION in the same commit.
 */

import { writeFileSync } from "node:fs";
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
  type PromotionActionInput,
} from "../src/index";

const OUT = "packages/schemas/vectors.json";

// Fixed, arbitrary inputs. They are not measurements and never become one; they
// exist so three languages can prove they produce identical bytes.
const parentId = "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
const workloadHash = labelHash("sha256/55-byte-single-block");
const environmentScopeHash = labelHash("rtx4060-laptop/8188MiB/566.26/cc8.9");
const sourceDigest = labelHash("candidate-source-v1");
const binaryDigest = labelHash("candidate-binary-v1");
const hypothesisHash = labelHash("rolling schedule should cut schedule re-reads");
const policyHash = labelHash("policy-v1");
const projectId = labelHash("gpu-vtec/sha256");
const channelHash = labelHash("stable");
const rawSamplesDigest = labelHash("raw-samples-v1");
const environmentDigest = labelHash("env-v1");

const owner = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as const; // anvil account 0
const verifyingContract = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as const;
const chainId = 31337n;

const candidateId = computeCandidateId({
  parentId,
  workloadHash,
  environmentScopeHash,
  sourceDigest,
  binaryDigest,
  hypothesisHash,
});

const report = {
  candidateId,
  policyHash,
  rawSamplesDigest,
  environmentDigest,
  verdict: "accepted" as const,
  observedAt: 1_700_000_000n,
};
const reportHash = computeReportHash(report);

const action: PromotionActionInput = {
  projectId,
  configVersion: 1n,
  owner,
  channelHash,
  candidateId,
  reportHash,
  policyHash,
  expectedPreviousReleaseId:
    "0x0000000000000000000000000000000000000000000000000000000000000000",
  nonce: 1n,
  deadline: 1_700_000_300n,
};

// A manifest whose keys are deliberately out of order and whose values include
// the things canonical JSON has to pin down: nesting, arrays, a float, a null.
const manifest = {
  task: "sha256",
  jobSizes: [256, 1024, 8192],
  accuracy: { vectors: 1000, oracle: "hashlib", kind: "bit-exact" },
  powerLimitW: null,
  noiseBand: 0.031,
  id: "sha256/55-byte-single-block",
};

const vectors = {
  note:
    "Shared encoding vectors for GPU VTEC. Python, TypeScript and Solidity must " +
    "all reproduce every value here. See packages/schemas/README.md.",
  schemaVersion: Number(SCHEMA_VERSION),
  eip712: {
    name: "GPUVTEC.KernelReleaseRegistry",
    version: "1",
    chainId: Number(chainId),
    verifyingContract,
    domainSeparator: domainSeparator(chainId, verifyingContract),
  },
  labelHash: {
    "gpu-vtec/sha256": projectId,
    stable: channelHash,
    "policy-v1": policyHash,
  },
  candidate: {
    input: {
      parentId,
      workloadHash,
      environmentScopeHash,
      sourceDigest,
      binaryDigest,
      hypothesisHash,
    },
    candidateId,
  },
  report: {
    input: {
      candidateId,
      policyHash,
      rawSamplesDigest,
      environmentDigest,
      verdict: "accepted",
      observedAt: Number(report.observedAt),
    },
    reportHash,
    digest: reportDigest(report, chainId, verifyingContract),
  },
  promotion: {
    input: {
      projectId: action.projectId,
      configVersion: Number(action.configVersion),
      owner: action.owner,
      channelHash: action.channelHash,
      candidateId: action.candidateId,
      reportHash: action.reportHash,
      policyHash: action.policyHash,
      expectedPreviousReleaseId: action.expectedPreviousReleaseId,
      nonce: Number(action.nonce),
      deadline: Number(action.deadline),
    },
    structHash: computePromotionStructHash(action),
    digest: promotionDigest(action, chainId, verifyingContract),
  },
  release: {
    input: {
      projectId,
      channelHash,
      candidateId,
      reportHash,
      previousReleaseId:
        "0x0000000000000000000000000000000000000000000000000000000000000000",
    },
    releaseId: computeReleaseId({
      projectId,
      channelHash,
      candidateId,
      reportHash,
      previousReleaseId:
        "0x0000000000000000000000000000000000000000000000000000000000000000",
    }),
  },
  canonicalJson: {
    input: manifest,
    encoded: canonicalJson(manifest),
    keccak: manifestKeccak(manifest),
  },
};

writeFileSync(OUT, `${JSON.stringify(vectors, null, 2)}\n`);
console.log(`wrote ${OUT}`);
console.log(`  candidateId  ${candidateId}`);
console.log(`  reportHash   ${reportHash}`);
console.log(`  promotion    ${vectors.promotion.digest}`);
