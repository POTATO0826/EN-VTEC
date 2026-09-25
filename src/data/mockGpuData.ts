/** Presentation fixtures only. No device detection, benchmark execution, or RPC. */
export type GpuId = "rtx3050" | "rtx4060";
export type WorkloadSize = "small" | "medium" | "large";
export type VariantId = "A" | "B" | "C" | "D";
export interface Gpu {
  id: GpuId;
  name: string;
  fullName: string;
  architecture: string;
  vram: number;
  sm: number;
  temperature: number;
  power: number;
  fingerprint: string;
}
export interface Benchmark {
  variant: VariantId;
  latency: number;
  baseline: number;
  reason: string;
}
export interface ChartPoint {
  batch: number;
  baseline: number;
  A: number;
  B: number;
  C: number;
  D: number;
  vtec: number;
}
export interface Attestation {
  id: string;
  hardwareFingerprint: string;
  variantHash: string;
  transactionHash: string;
  block: string;
  recordedAt: string;
  gpu: GpuId;
  workload: WorkloadSize;
  variant: VariantId;
  latency: number;
  status: "ATTESTED";
  simulated: true;
}
export interface Candidate {
  id: string;
  change: string;
  correct: boolean;
  speedup: number | null;
  verdict: "REJECTED" | "ACCEPTED";
  reason: string;
}

export const GPUS: Gpu[] = [
  {
    id: "rtx3050",
    name: "RTX 3050 Laptop",
    fullName: "RTX 3050 Laptop GPU",
    architecture: "AMPERE",
    vram: 4,
    sm: 20,
    temperature: 62,
    power: 58,
    fingerprint: "0xab12c78e459a0183d647bf9250c38aef1d2b9f02",
  },
  {
    id: "rtx4060",
    name: "RTX 4060",
    fullName: "RTX 4060 GPU",
    architecture: "ADA LOVELACE",
    vram: 8,
    sm: 24,
    temperature: 54,
    power: 92,
    fingerprint: "0xcd46a18b572f8032e947cdb693e2a6514c6d8a10",
  },
];
export const WORKLOADS: { id: WorkloadSize; label: string; batch: number }[] = [
  { id: "small", label: "Small", batch: 256 },
  { id: "medium", label: "Medium", batch: 8192 },
  { id: "large", label: "Large", batch: 65536 },
];
export const VARIANTS: Record<
  VariantId,
  { name: string; mode: string; color: string; detail: string }
> = {
  A: {
    name: "BASE CAM",
    mode: "STANDARD",
    color: "#af9bda",
    detail: "Conservative thread configuration",
  },
  B: {
    name: "LOW-LIFT",
    mode: "ECO",
    color: "#8db6ec",
    detail: "Lower register pressure",
  },
  C: {
    name: "MID-CAM",
    mode: "MID",
    color: "#e1b779",
    detail: "Balanced parallel work",
  },
  D: {
    name: "HIGH-LIFT",
    mode: "VTEC",
    color: "#c6ed93",
    detail: "More work per thread",
  },
};
export const BENCHMARKS: Record<GpuId, Record<WorkloadSize, Benchmark>> = {
  rtx3050: {
    small: {
      variant: "B",
      latency: 3.1,
      baseline: 5.27,
      reason:
        "Variant B avoids unnecessary register pressure. At 256 inputs, a lighter kernel gets more from this GPU than extra parallel work.",
    },
    medium: {
      variant: "C",
      latency: 6.4,
      baseline: 12.8,
      reason:
        "Variant C balances occupancy and work per thread. At 8,192 inputs, it uses the RTX 3050’s 20 SMs more efficiently.",
    },
    large: {
      variant: "C",
      latency: 10.8,
      baseline: 24.84,
      reason:
        "Larger batches benefit from more parallel work per thread. Variant C improves throughput without exhausting the RTX 3050’s register budget.",
    },
  },
  rtx4060: {
    small: {
      variant: "B",
      latency: 2.1,
      baseline: 3.78,
      reason:
        "At 256 inputs, launch and register overhead still dominate. Variant B’s lighter configuration wins even on the newer GPU.",
    },
    medium: {
      variant: "D",
      latency: 4.2,
      baseline: 11.34,
      reason:
        "The RTX 4060’s architecture and 24 SMs sustain more work per thread. Variant D reaches its crossover point earlier on this GPU.",
    },
    large: {
      variant: "D",
      latency: 7.0,
      baseline: 23.8,
      reason:
        "Variant D wins because the larger workload benefits from additional work per thread on the RTX 4060. More hardware headroom makes high-lift worthwhile.",
    },
  },
};

const chart = (rows: number[][]): ChartPoint[] =>
  rows.map(([batch, baseline, A, B, C, D]) => ({
    batch,
    baseline,
    A,
    B,
    C,
    D,
    vtec: Math.min(A, B, C, D),
  }));
export const CHART_POINTS: Record<GpuId, ChartPoint[]> = {
  rtx3050: chart([
    [256, 5.27, 4.4, 3.1, 4.5, 5.8],
    [512, 6.1, 4.8, 3.6, 4.7, 6.0],
    [2048, 9.4, 6.0, 5.6, 5.1, 6.4],
    [8192, 12.8, 8.5, 8.2, 6.4, 7.5],
    [32768, 18.5, 14.5, 12.8, 8.5, 9.8],
    [65536, 24.84, 21.2, 18.6, 10.8, 12.4],
  ]),
  rtx4060: chart([
    [256, 3.78, 3.2, 2.1, 3.0, 4.8],
    [512, 4.5, 3.6, 2.5, 3.3, 4.7],
    [2048, 7.1, 4.9, 4.1, 3.8, 4.4],
    [8192, 11.34, 7.6, 6.2, 4.8, 4.2],
    [32768, 17.8, 12.8, 10.0, 6.5, 5.6],
    [65536, 23.8, 18.6, 14.7, 9.2, 7.0],
  ]),
};

export const WORKLOAD_FEED = [
  { id: "WK-0842", kernel: "SHA-256", batch: 256, status: "QUEUED" },
  { id: "WK-0841", kernel: "SHA-256", batch: 8192, status: "RUNNING" },
  { id: "WK-0840", kernel: "SHA-256", batch: 65536, status: "READY" },
  { id: "WK-0839", kernel: "SHA-256", batch: 512, status: "QUEUED" },
] as const;
export const PIPELINE_STEPS = [
  "GPU profile",
  "Generate candidate",
  "Compile",
  "Correctness",
  "Benchmark",
  "Noise check",
  "Accept / reject",
];
export const DEMO_TIMING = {
  scan: 500,
  crossover: 1400,
  pipelineStep: 380,
  feedPulse: 3600,
};
export const DEMO_INFO = {
  kernel: "SHA-256",
  session: "VTC-0084",
  samples: 100,
  noiseBand: 3,
  historyCount: 128,
  runtime: "02:41:08",
  recordedAt: "2026-09-18T14:32:08Z",
};
export const speedup = (result: Benchmark) => result.baseline / result.latency;
export const batchLabel = (batch: number) => batch.toLocaleString("en-US");

// Stable fixtures with the same interface a future data adapter can supply.
export const REGISTRY = GPUS.flatMap((gpu) =>
  WORKLOADS.map((workload) => ({
    gpu: gpu.id,
    workload: workload.id,
    ...BENCHMARKS[gpu.id][workload.id],
  })),
);
export const CANDIDATES: Record<
  GpuId,
  Record<WorkloadSize, Candidate[]>
> = Object.fromEntries(
  GPUS.map((gpu) => [
    gpu.id,
    Object.fromEntries(
      WORKLOADS.map((workload) => {
        const result = BENCHMARKS[gpu.id][workload.id];
        return [
          workload.id,
          [
            {
              id: "EXP-041",
              change: "Reduce launch overhead",
              correct: true,
              speedup: 1.03,
              verdict: "REJECTED",
              reason: "Within the 3% noise band. No reliable improvement.",
            },
            {
              id: "EXP-042",
              change: "Aggressive loop unroll",
              correct: false,
              speedup: null,
              verdict: "REJECTED",
              reason: "Output mismatch. Benchmark excluded before selection.",
            },
            {
              id: "EXP-043",
              change: "Tune thread block size",
              correct: true,
              speedup: Number((speedup(result) * 0.82).toFixed(2)),
              verdict: "ACCEPTED",
              reason:
                "Correct output and a repeatable improvement over baseline.",
            },
            {
              id: "EXP-044",
              change: `Refine ${VARIANTS[result.variant].name.toLowerCase()} configuration`,
              correct: true,
              speedup: speedup(result),
              verdict: "ACCEPTED",
              reason: `Best verified result for this hardware and workload. Variant ${result.variant} recorded.`,
            },
          ] satisfies Candidate[],
        ];
      }),
    ),
  ]),
) as Record<GpuId, Record<WorkloadSize, Candidate[]>>;

export const ATTESTATIONS: Attestation[] = REGISTRY.map((entry, index) => ({
  id: `VTC-${String(842 + index).padStart(6, "0")}`,
  hardwareFingerprint: GPUS.find((gpu) => gpu.id === entry.gpu)!.fingerprint,
  variantHash: `0x93fd${(index + 1).toString(16).padStart(56, "0")}a813`,
  transactionHash: `0x83f0${(index + 1).toString(16).padStart(56, "0")}0901`,
  block: (21884097 + index).toLocaleString("en-US"),
  recordedAt: DEMO_INFO.recordedAt,
  gpu: entry.gpu,
  workload: entry.workload,
  variant: entry.variant,
  latency: entry.latency,
  status: "ATTESTED",
  simulated: true,
}));
export const getAttestation = (gpu: GpuId, workload: WorkloadSize) =>
  ATTESTATIONS.find((item) => item.gpu === gpu && item.workload === workload)!;
export const shortHash = (hash: string) =>
  `${hash.slice(0, 8)}…${hash.slice(-4)}`;
