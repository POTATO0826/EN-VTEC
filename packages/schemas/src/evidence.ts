/**
 * The evidence objects from build plan section 7.
 *
 * These are the shapes that travel between the evaluator (Python, your friend's
 * column), the API, the identity bridge, the contract and the consumer. They are
 * deliberately flat and made of primitives, because every one of them ends up
 * being hashed and a nested optional is a digest that changes for no reason.
 *
 * Nothing here is measured. The API stores what the evaluator reports; the
 * evaluator is the only thing allowed to produce timings.
 */

import type { Hex } from "viem";
import type { Verdict } from "./ids";

/** What is being optimized, and under what rules. Section 7. */
export type WorkloadManifest = {
  /** Stable name: "sha256/55-byte-single-block" or "transformer/prenorm-block". */
  id: string;
  task: string;
  /** Free-form but frozen once sealed - shapes, dtype, mask, semantics. */
  semantics: Record<string, string | number | boolean>;
  /** Job sizes, in ascending order. */
  jobSizes: number[];
  /**
   * Bit-exact for SHA-256, tolerance-based for floating point. Exactly one of
   * these is set, because the acceptance policy differs completely between them.
   */
  accuracy:
    | { kind: "bit-exact"; oracle: string; vectors: number }
    | { kind: "tolerance"; oracle: string; rtol: number; atol: number };
};

/**
 * The machine, in enough detail that a consumer can tell whether a release was
 * measured somewhere close enough to its own hardware to be worth adopting.
 *
 * `powerLimitW` is here because section 6a makes it part of the scope: the same
 * laptop GPU ships anywhere from roughly 35 W to 115 W, and a result measured at
 * one is not a result at the other. Null means not recorded, and a consumer
 * treats an unrecorded scope as a reason to stay on the baseline.
 */
export type EnvironmentManifest = {
  gpuName: string;
  vramMb: number;
  smCount: number;
  computeCapability: string;
  driverVersion: string;
  cudaVersion: string | null;
  powerLimitW: number | null;
  powerMode: string | null;
  os: string;
  python: string | null;
  /** Digest of the pinned dependency set. */
  dependencyDigest: Hex | null;
};

/** One proposed change. Section 7. */
export type CandidateRecord = {
  candidateId: Hex;
  projectId: Hex;
  parentId: Hex;
  workloadHash: Hex;
  environmentScopeHash: Hex;
  sourceDigest: Hex;
  binaryDigest: Hex;
  hypothesisHash: Hex;
  manifestHash: Hex;
  /** Plain-English hypothesis, kept off-chain; `hypothesisHash` pins it. */
  hypothesis: string;
  createdAt: string;
};

/** One timing case: a job size, its samples, and what the samples mean. */
export type TimingCase = {
  jobSize: number;
  /** Raw per-run milliseconds, baseline and candidate, paired and in order. */
  baselineMs: number[];
  candidateMs: number[];
  baselineMedianMs: number;
  candidateMedianMs: number;
  /** Fraction, not a percentage. 0.031 is 3.1%. */
  noiseBand: number;
  speedup: number;
};

/**
 * What the evaluator signs. Section 6's acceptance rule decides `verdict`, and
 * the evaluator is the only thing allowed to set it.
 */
export type RunReport = {
  reportHash: Hex;
  candidateId: Hex;
  policyHash: Hex;
  rawSamplesDigest: Hex;
  environmentDigest: Hex;
  verdict: Verdict;
  observedAt: number;
  /** Populated for a correctness failure; the candidate is then never timed. */
  correctness: { passed: boolean; detail: string };
  cases: TimingCase[];
  /** Compile errors, timeouts, OOM. Kept, never discarded. */
  failures: string[];
  evaluator: Hex;
  signature: Hex | null;
};

/** One attempt, successful or not. Section 7's experiment log. */
export type ExperimentEntry = {
  at: string;
  candidateId: Hex | null;
  hypothesis: string;
  outcome: "compiled" | "compile-failed" | "wrong-output" | "timed" | "oom" | "timeout";
  detail: string;
};

/** A pending publication, before any signature exists. Section 7. */
export type ReleaseProposal = {
  proposalId: string;
  projectId: Hex;
  channel: string;
  channelHash: Hex;
  candidateId: Hex;
  reportHash: Hex;
  policyHash: Hex;
  expectedPreviousReleaseId: Hex;
  nonce: string;
  deadline: number;
  owner: Hex;
  configVersion: number;
  /** The EIP-712 digest the owner and the bridge each sign. */
  digest: Hex;
  status: ProposalStatus;
  createdAt: string;
};

export type ProposalStatus =
  | "pending" // built, nothing signed
  | "consented" // the operator has seen the contents and agreed in-app
  | "identity-started" // the identity journey is open
  | "permitted" // the bridge has issued its signature
  | "submitted" // relayed to the chain
  | "published" // confirmed onchain
  | "cancelled"
  | "expired"
  | "failed";

/** Streamed to the UI over SSE. Section 3: "structured progress and attempt outcomes". */
export type JobEvent =
  | { type: "job"; status: "queued" | "running" | "done" | "failed"; detail: string }
  | { type: "candidate"; status: "accepted"; candidateId: Hex; speedup: number }
  | { type: "candidate"; status: "rejected"; candidateId: Hex; why: string }
  | { type: "candidate"; status: "failed"; candidateId: Hex; why: string }
  | { type: "note"; detail: string };

export type JobRecord = {
  jobId: string;
  projectId: Hex;
  workloadId: string;
  status: "queued" | "running" | "done" | "failed";
  /** Section 5: five candidates or 20 minutes, whichever comes first. */
  budgetCandidates: number;
  budgetSeconds: number;
  createdAt: string;
  /** Set when the client supplies one, so a retry cannot enqueue twice. */
  idempotencyKey: string | null;
};
