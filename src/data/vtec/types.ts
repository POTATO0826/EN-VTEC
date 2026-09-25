/**
 * Data contracts for GPU VTEC.
 *
 * Nothing here is measured. Every value is a typed fixture so the whole UI can
 * be built and reviewed before the backend exists. The shapes are the contract
 * the backend will have to satisfy.
 */

export type VariantId = "A" | "B" | "C" | "D" | "E";

export type TaskId = "sha256" | "keccak256";

export type GPU = {
  id: string;
  name: string;
  vramMb: number;
  smCount: number;
  l2CacheMb: number;
  computeCapability: string;
  driverVersion: string;
  hwFingerprint: string;
  status: "online" | "offline";
  /**
   * Board power limit in watts. Section 6a of the build plan makes this part of
   * the hardware scope, because the same laptop GPU ships anywhere from roughly
   * 35 W to 115 W and a result measured at one is not a result at the other.
   *
   * Null until someone runs `nvidia-smi -q -d POWER` and records it. Null is
   * rendered as "not recorded", never as a number, because inventing it would
   * put a fabricated value inside the scope a release is published against.
   */
  powerLimitW: number | null;
  /** The power mode the measurement was taken under. Null until recorded. */
  powerMode: string | null;
};

export type DispatchResult = {
  variant: string;
  label: string;
  medianMs: number;
  speedup: number;
  noiseBand: number;
  reason: string;
  attestationTx: string;
};

export type RegistryEntry = {
  gpu: string;
  task: string;
  bucket: "small" | "mid" | "large";
  variant: string;
  label: string;
  speedup: number;
  planHash: string;
  tx: string;
  /** The real job size behind the bucket. Buckets are never shown on their own. */
  jobSize: number;
  runId: string;
  /** Set when the baseline was retained because nothing cleared the noise band. */
  baselineRetained?: boolean;
};

export type NodeStatus =
  | "queued"
  | "compiling"
  | "processing"
  | "passed"
  | "accepted"
  | "rejected"
  | "failed"
  | "skipped"
  | "published";

export type PipelineNode = {
  id: string;
  kind: "plan" | "commit" | "variant" | "gate" | "registry" | "ens";
  label: string;
  status: NodeStatus;
  reason?: string;
  timings?: { runs: number[]; medianMs: number; stdevMs: number };
  startedAt?: string;
  endedAt?: string;
  /** Replay ordering: the tick at which this node reaches its final status. */
  tick: number;
  /** Which variant this node belongs to, for path highlighting. */
  variant?: VariantId;
  /** Terminal nodes must always carry a reason. */
  terminal?: boolean;
};

export type PipelineEdge = {
  id: string;
  source: string;
  target: string;
  variant?: VariantId;
};

export type RunEvent =
  | { type: "candidate"; status: "accepted"; variant: string; speedup: number }
  | { type: "candidate"; status: "rejected"; why: string }
  | { type: "candidate"; status: "failed"; why: string };

/** The rules, as sealed. This object is what gets hashed. */
export type TestPlan = {
  task: TaskId;
  messageLengthBytes: number;
  batchSizes: number[];
  variantPool: VariantId[];
  baselineVariant: VariantId;
  runsPerMeasurement: number;
  targetMsPerMeasurement: number;
  oracle: { name: string; vectors: number; boundaries: number[] };
  acceptanceRule: "beats-baseline-by-more-than-noise-band";
};

export type CandidateVerdict = "accepted" | "rejected" | "failed" | "skipped";

export type Candidate = {
  variant: VariantId;
  label: string;
  correct: boolean;
  /** Absent when the candidate was never timed (wrong output, or not run). */
  medianMs?: number;
  speedup?: number;
  /** Percentage points of gain, positive or negative, against the noise band. */
  gainPct?: number;
  verdict: CandidateVerdict;
  reason: string;
  timings?: { runs: number[]; medianMs: number; stdevMs: number };
  /** The discarded first run. Kept so the sheet can show what was thrown away. */
  warmupMs?: number;
};

export type IncomingJob = {
  id: string;
  jobSize: number;
  arrivedAt: string;
  variant: VariantId;
  medianMs: number;
};

export type ResultStatus = "verified" | "no-winner" | "running";

export type Run = {
  id: string;
  gpuId: string;
  task: TaskId;
  status: ResultStatus;
  createdAt: string;
  /** The job size this run's headline numbers describe. */
  headlineJobSize: number;
  noiseBand: number;
  plan: TestPlan;
  planHash: string;
  commitTx: string;
  revealTx: string;
  chain: string;
  committedBy: "passkey" | "wallet";
  ensName?: string;
  /** ms per variant, indexed against plan.batchSizes. null where not run. */
  curves: Partial<Record<VariantId, (number | null)[]>>;
  /** Job sizes that were never attempted, with the reason. */
  skipped: { jobSize: number; reason: string }[];
  candidates: Candidate[];
  dispatcher: DispatchResult;
  incoming: IncomingJob[];
  jobsPerHourBefore: number;
  jobsPerHourAfter: number;
  configPath: string;
};

export type Project = {
  id: string;
  runId: string;
  name: string;
  gpuName: string;
  task: TaskId;
  createdAt: string;
  planHash: string;
  status: ResultStatus | "sealed" | "draft";
  ensName?: string;
};
