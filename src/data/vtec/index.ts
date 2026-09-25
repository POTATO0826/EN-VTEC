import { num, pct, shortHash, speedup as fmtSpeedup } from "@/lib/format";
import type {
  Candidate,
  GPU,
  IncomingJob,
  PipelineEdge,
  PipelineNode,
  RegistryEntry,
  Run,
  VariantId,
} from "./types";
import { GPU_BY_ID, RUNS } from "./runs";
import { VARIANTS, variantName } from "./variants";

export * from "./types";
export { GPUS, GPU_BY_ID, RUNS, fakeHex, buildTimings } from "./runs";
export { VARIANTS, VARIANT_ORDER, TASKS, variantName, variantShort } from "./variants";

/* -------------------------------------------------------------------------- */
/* Lookups                                                                     */
/* -------------------------------------------------------------------------- */

export function runById(id: string): Run | undefined {
  return RUNS.find((run) => run.id === id);
}

export function gpuFor(run: Run): GPU {
  return GPU_BY_ID[run.gpuId];
}

export function runsForGpu(gpuId: string): Run[] {
  return RUNS.filter((run) => run.gpuId === gpuId);
}

/** ms for one variant at one job size, or null if it was never timed there. */
export function msAt(
  run: Run,
  variant: VariantId,
  sizeIndex: number,
): number | null {
  const curve = run.curves[variant];
  if (!curve) return null;
  const value = curve[sizeIndex];
  return value ?? null;
}

/** Job sizes that actually produced a measurement. */
export function completedSizes(run: Run): number[] {
  return run.plan.batchSizes.filter((_size, index) =>
    Object.keys(run.curves).some(
      (variant) => msAt(run, variant as VariantId, index) !== null,
    ),
  );
}

export function skipReason(run: Run, jobSize: number): string | undefined {
  return run.skipped.find((entry) => entry.jobSize === jobSize)?.reason;
}

/** Variants that produced a correct, timed result somewhere in this run. */
export function timedVariants(run: Run): VariantId[] {
  return (Object.keys(run.curves) as VariantId[]).filter((variant) =>
    (run.curves[variant] ?? []).some((value) => value !== null),
  );
}

/**
 * Who wins at one job size, under the plan's own acceptance rule: a candidate
 * only displaces the baseline if it beats it by more than the noise band.
 * When nothing does, the baseline is the answer - that is a result, not a gap.
 */
export function winnerAt(
  run: Run,
  sizeIndex: number,
): { variant: VariantId; medianMs: number; speedup: number } | null {
  const baselineVariant = run.plan.baselineVariant;
  const baselineMs = msAt(run, baselineVariant, sizeIndex);
  if (baselineMs === null) return null;

  let best: { variant: VariantId; medianMs: number } = {
    variant: baselineVariant,
    medianMs: baselineMs,
  };
  for (const variant of timedVariants(run)) {
    if (variant === baselineVariant) continue;
    const value = msAt(run, variant, sizeIndex);
    if (value === null) continue;
    const gain = ((baselineMs - value) / baselineMs) * 100;
    if (gain > run.noiseBand && value < best.medianMs) {
      best = { variant, medianMs: value };
    }
  }
  return {
    ...best,
    speedup: Number((baselineMs / best.medianMs).toFixed(4)),
  };
}

export function winnerAtSize(run: Run, jobSize: number) {
  const index = run.plan.batchSizes.indexOf(jobSize);
  return index < 0 ? null : winnerAt(run, index);
}

export function acceptedCandidate(run: Run): Candidate | undefined {
  return run.candidates.find((candidate) => candidate.verdict === "accepted");
}

/* -------------------------------------------------------------------------- */
/* Chart                                                                       */
/* -------------------------------------------------------------------------- */

export type ChartRow = {
  jobSize: number;
  dispatcher: number | null;
} & Partial<Record<VariantId, number | null>>;

export function chartRows(run: Run): ChartRow[] {
  return run.plan.batchSizes
    .map((jobSize, index) => {
      const row: ChartRow = { jobSize, dispatcher: null };
      for (const variant of timedVariants(run)) {
        row[variant] = msAt(run, variant, index);
      }
      row.dispatcher = winnerAt(run, index)?.medianMs ?? null;
      return row;
    })
    .filter((row) => row.dispatcher !== null);
}

/* -------------------------------------------------------------------------- */
/* Registry                                                                    */
/* -------------------------------------------------------------------------- */

/** The three job sizes a GPU card is summarised by. Always shown as real numbers. */
export function bucketSizes(
  run: Run,
): { bucket: RegistryEntry["bucket"]; jobSize: number }[] {
  const sizes = completedSizes(run);
  if (sizes.length === 0) return [];
  if (sizes.length === 1) return [{ bucket: "small", jobSize: sizes[0] }];
  if (sizes.length === 2) {
    return [
      { bucket: "small", jobSize: sizes[0] },
      { bucket: "large", jobSize: sizes[1] },
    ];
  }
  return [
    { bucket: "small", jobSize: sizes[0] },
    { bucket: "mid", jobSize: sizes[Math.floor((sizes.length - 1) / 2)] },
    { bucket: "large", jobSize: sizes[sizes.length - 1] },
  ];
}

export const REGISTRY: RegistryEntry[] = RUNS.flatMap((run) =>
  bucketSizes(run).flatMap(({ bucket, jobSize }) => {
    const winner = winnerAtSize(run, jobSize);
    if (!winner) return [];
    const entry: RegistryEntry = {
      gpu: gpuFor(run).name,
      task: run.task,
      bucket,
      variant: winner.variant,
      label: VARIANTS[winner.variant].label,
      speedup: winner.speedup,
      planHash: run.planHash,
      tx: run.revealTx,
      jobSize,
      runId: run.id,
      baselineRetained: winner.variant === run.plan.baselineVariant,
    };
    return [entry];
  }),
);

export function registryForGpu(gpuId: string): RegistryEntry[] {
  const runs = runsForGpu(gpuId);
  return REGISTRY.filter((entry) => runs.some((run) => run.id === entry.runId));
}

/* -------------------------------------------------------------------------- */
/* Homepage summary                                                            */
/* -------------------------------------------------------------------------- */

export const SUMMARY = (() => {
  const best = REGISTRY.reduce((a, b) => (b.speedup > a.speedup ? b : a));
  return {
    cardsInRegistry: new Set(RUNS.map((run) => run.gpuId)).size,
    verifiedResults: REGISTRY.length,
    tasksCovered: new Set(RUNS.map((run) => run.task)).size,
    best,
    bestLabel: `${fmtSpeedup(best.speedup)} — ${best.gpu}, ${num(best.jobSize)} messages`,
    noWinnerCount: RUNS.filter((run) => run.status === "no-winner").length,
  };
})();

/* -------------------------------------------------------------------------- */
/* Incoming work (from the operator's own prover - never supplied by us)       */
/* -------------------------------------------------------------------------- */

export function incomingFor(run: Run): IncomingJob[] {
  const sizes = completedSizes(run);
  if (sizes.length === 0) return [];
  const pattern = [
    sizes.length - 1,
    0,
    Math.min(1, sizes.length - 1),
    sizes.length - 1,
    0,
    Math.max(0, sizes.length - 2),
  ];
  const base = new Date(run.createdAt).getTime();
  return pattern.map((sizeIndex, i) => {
    const jobSize = sizes[sizeIndex];
    const planIndex = run.plan.batchSizes.indexOf(jobSize);
    const winner = winnerAt(run, planIndex);
    return {
      id: `${run.id}-in-${i}`,
      jobSize,
      arrivedAt: new Date(base + (i + 1) * 47_000).toISOString(),
      variant: (winner?.variant ?? run.plan.baselineVariant) as VariantId,
      medianMs: winner?.medianMs ?? 0,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Pipeline graph                                                              */
/* -------------------------------------------------------------------------- */

export type Pipeline = {
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  /** Number of replay ticks. The scrubber runs from 0 to this value. */
  ticks: number;
};

/**
 * The same graph is the live run monitor and the permanent audit trail. Each
 * node carries the tick at which it reaches its final status, so a scrubber (or
 * a live stream) can replay the run from queued to published without a second
 * data shape.
 */
export function buildPipeline(run: Run): Pipeline {
  const nodes: PipelineNode[] = [];
  const edges: PipelineEdge[] = [];
  const baselineVariant = run.plan.baselineVariant;
  const pool = run.plan.variantPool;
  const n = pool.length;
  const winner = acceptedCandidate(run);

  nodes.push({
    id: "plan",
    kind: "plan",
    label: "Test plan",
    status: "published",
    reason: `Hashed to ${shortHash(run.planHash)} before any kernel was compiled.`,
    tick: 1,
  });
  nodes.push({
    id: "commit",
    kind: "commit",
    label: "Commit tx",
    status: "published",
    reason: `${shortHash(run.commitTx)} on ${run.chain}. The rules were locked before the first measurement.`,
    tick: 2,
  });
  edges.push({ id: "e-plan-commit", source: "plan", target: "commit" });

  pool.forEach((variant, i) => {
    const isBaseline = variant === baselineVariant;
    const candidate = run.candidates.find((c) => c.variant === variant);
    const varId = `var-${variant}`;
    const corrId = `corr-${variant}`;
    const gateId = `gate-${variant}`;

    nodes.push({
      id: varId,
      kind: "variant",
      label: variantName(variant),
      status: "passed",
      reason: VARIANTS[variant].detail,
      tick: 3 + i,
      variant,
    });
    edges.push({
      id: `e-commit-${varId}`,
      source: "commit",
      target: varId,
      variant,
    });

    const failed = candidate?.verdict === "failed";
    nodes.push({
      id: corrId,
      kind: "gate",
      label: "correctness",
      status: failed ? "failed" : "passed",
      reason: failed
        ? candidate.reason
        : `Matches ${run.plan.oracle.name} on all ${num(run.plan.oracle.vectors)} vectors, including the ${run.plan.oracle.boundaries.join(", ")}-byte padding boundaries.`,
      tick: 3 + n + i,
      variant,
      terminal: failed,
    });
    edges.push({
      id: `e-${varId}-${corrId}`,
      source: varId,
      target: corrId,
      variant,
    });

    if (failed) return;

    const timings = candidate?.timings;
    nodes.push({
      id: gateId,
      kind: "gate",
      label: "noise gate",
      status: isBaseline ? "passed" : (candidate?.verdict ?? "rejected"),
      reason: isBaseline
        ? `Baseline. ${run.plan.runsPerMeasurement} runs, first discarded, spread of the remaining ${run.plan.runsPerMeasurement - 1} sets this machine's noise band at ${pct(run.noiseBand)}.`
        : (candidate?.reason ?? ""),
      timings: timings ?? undefined,
      tick: 3 + 2 * n + i,
      variant,
      terminal: true,
    });
    edges.push({
      id: `e-${corrId}-${gateId}`,
      source: corrId,
      target: gateId,
      variant,
    });
    edges.push({
      id: `e-${gateId}-registry`,
      source: gateId,
      target: "registry",
      variant,
    });
  });

  // Job sizes that were never attempted are part of the record, not a gap in it.
  run.skipped.forEach((entry, i) => {
    const id = `skip-${entry.jobSize}`;
    nodes.push({
      id,
      kind: "gate",
      label: `job: ${num(entry.jobSize)} messages`,
      status: "skipped",
      reason: entry.reason,
      tick: 3 + n + i,
      terminal: true,
    });
    edges.push({ id: `e-commit-${id}`, source: "commit", target: id });
  });

  const registryTick = 3 + 3 * n;
  nodes.push({
    id: "registry",
    kind: "registry",
    label: run.status === "no-winner" ? "baseline retained" : "registry",
    status: run.status === "no-winner" ? "passed" : "published",
    reason:
      run.status === "no-winner"
        ? `No candidate cleared the ${pct(run.noiseBand)} noise band. ${variantName(baselineVariant)} stays in use at ${num(run.headlineJobSize)} messages.`
        : `${variantName((winner?.variant ?? baselineVariant) as VariantId)} recorded for ${gpuFor(run).name} at ${num(run.headlineJobSize)} messages.`,
    tick: registryTick,
  });
  nodes.push({
    id: "reveal",
    kind: "commit",
    label: "Reveal tx",
    status: "published",
    reason: `${shortHash(run.revealTx)} on ${run.chain}. The result is published against the plan hash that was sealed first.`,
    tick: registryTick + 1,
  });
  edges.push({ id: "e-registry-reveal", source: "registry", target: "reveal" });

  if (run.ensName) {
    nodes.push({
      id: "ens",
      kind: "ens",
      label: run.ensName,
      status: "published",
      reason: `Readable outside this app. Anyone can resolve ${run.ensName} without our software.`,
      tick: registryTick + 2,
    });
    edges.push({ id: "e-reveal-ens", source: "reveal", target: "ens" });
  }

  const ticks = Math.max(...nodes.map((node) => node.tick));
  return { nodes, edges, ticks };
}

/**
 * The node's status as of a point in the replay. Before its tick it is queued;
 * on the tick before, it is in flight; after, it holds its recorded status.
 */
export function statusAtTick(
  node: PipelineNode,
  tick: number,
): PipelineNode["status"] {
  if (tick >= node.tick) return node.status;
  if (tick >= node.tick - 1) {
    return node.kind === "variant" ? "compiling" : "processing";
  }
  return "queued";
}

/** Replays a run as the event stream a live WebSocket would produce. */
export function runEvents(run: Run) {
  return run.candidates.map((candidate) => {
    if (candidate.verdict === "accepted") {
      return {
        type: "candidate" as const,
        status: "accepted" as const,
        variant: candidate.variant,
        speedup: candidate.speedup ?? 1,
      };
    }
    if (candidate.verdict === "failed") {
      return {
        type: "candidate" as const,
        status: "failed" as const,
        why: candidate.reason,
      };
    }
    return {
      type: "candidate" as const,
      status: "rejected" as const,
      why: candidate.reason,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Explorer links - deliberately third party, so the record is checkable       */
/* -------------------------------------------------------------------------- */

export function txUrl(chain: string, tx: string): string {
  const host =
    chain === "Base"
      ? "https://basescan.org"
      : chain === "Sepolia"
        ? "https://sepolia.etherscan.io"
        : "https://etherscan.io";
  return `${host}/tx/${tx}`;
}

export function ensUrl(name: string): string {
  return `https://app.ens.domains/${name}`;
}
