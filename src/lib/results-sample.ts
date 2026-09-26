import { SPOKES, type Metrics, type ResultEntry, type VerifierRun } from "./results";

/**
 * Sample entries for /results?sample=1: several tracks, several verifiers
 * each, every spoke measured. Mock numbers, labelled as such.
 */

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Full = Record<string, number>;

/** Runs from a baseline × per-spoke multiplier, with per-verifier jitter. */
function mkRuns(base: Full, mult: Full, verifiers: string[], jitter: number, seed: number, override?: Partial<Full>) {
  const r = rng(seed);
  return verifiers.map((who) => ({
    who,
    metrics: Object.fromEntries(
      SPOKES.map((s) => [s.key, base[s.key] * mult[s.key] * (1 + (r() - 0.5) * 2 * (override?.[s.key] ?? jitter))]),
    ) as Metrics,
  }));
}

const scale = (base: Full, m: Full) => Object.fromEntries(SPOKES.map((s) => [s.key, base[s.key] * m[s.key]])) as Metrics;

function report(who: string, hardware: string, speedup: number, baselineS: number, candidateS: number, pass: boolean, why: string, runs: number): VerifierRun {
  return {
    who,
    hardware,
    reported: true,
    report: { speedup, baselineS, candidateS, pass, reason: `${speedup.toFixed(2)}× ${pass ? "faster" : "not faster"}: ${why}.`, runs, identical: true },
  };
}

// Baselines: times in seconds, spread in percent, precision as the error at the tolerance (0 = at tolerance).
const B4060: Full = { speed: 4.93, best: 4.84, worst: 5.05, cold: 6.4, noise: 3.8, precision: 1e-3 };
const B4090: Full = { speed: 3.1, best: 3.02, worst: 3.2, cold: 4.1, noise: 2.9, precision: 1e-3 };
const BM3: Full = { speed: 7.9, best: 7.7, worst: 8.2, cold: 9.8, noise: 3.1, precision: 1e-3 };

const T = (h: string) => `2026-09-26T${h}:00+08:00`;
const SHA = (s: string) => (s + "0".repeat(64)).slice(0, 64);
const RTX4060L = "NVIDIA GeForce RTX 4060 Laptop GPU";
const RTX4090 = "NVIDIA GeForce RTX 4090";
const fee = (digest: string) => ({ worldId: true, fee: { digest, amountSui: 0.01 } });

export const SAMPLE_ENTRIES: ResultEntry[] = [
  {
    id: "coding",
    set: "harness",
    label: "Coding",
    workload: "RMSNorm kernel",
    hardware: RTX4060L,
    model: "RMSNorm kernel",
    track: "rmsnorm-4096",
    kernel: { name: "tuned (float4 + warp shuffle)", rank: 2, of: 14 },
    baseline: B4060,
    top1: scale(B4060, { speed: 0.4, best: 0.4, worst: 0.41, cold: 0.55, noise: 0.4, precision: 0.05 }),
    runs: mkRuns(B4060, { speed: 0.43, best: 0.43, worst: 0.44, cold: 0.6, noise: 0.5, precision: 0.24 }, ["Platform harness"], 0.03, 11),
    tolerance: 1e-3,
    detail: {
      status: "verified",
      submittedAt: T("07:12"),
      buildSha256: SHA("f0f21b6611ad3d74c9a1e"),
      gpu: RTX4060L,
      runtimeS: 2.4,
      approval: fee("9tKq2mVx3BnYpLwC7rZsHd4eFgJ1uT8aQ"),
      draw: { source: "AeR5sN2vLk9pXm3TqW7yBc1zDf6gHj4u" },
      quorum: 1,
      harness: true,
      harnessRunning: false,
      verifiers: [
        report("Platform harness", `${RTX4060L} + Intel(R) Core(TM) i7-14650HX`, 2.34, 5.05, 2.16, true, "every run beat the baseline, well beyond the noise (±7.2%)", 4),
      ],
      outcome: { speedup: 2.34, at: T("07:12") },
      feeSettlement: { digest: "Zx8cVb2nMq4wErT6yUi9oPa1sDf3gHj5k", recipients: 1, amountSui: 0.01 },
    },
  },
  {
    id: "render",
    set: "harness",
    label: "3D Rendering",
    workload: "Ray–triangle intersection",
    hardware: RTX4090,
    model: "BVH traversal · 2M tris",
    track: "rt-intersect",
    kernel: { name: "Möller–Trumbore SIMT · tuned (warp-coherent)", rank: null, of: 9 },
    baseline: B4090,
    top1: scale(B4090, { speed: 0.6, best: 0.6, worst: 0.62, cold: 0.7, noise: 0.5, precision: 0.02 }),
    runs: mkRuns(B4090, { speed: 0.71, best: 0.7, worst: 0.73, cold: 0.8, noise: 0.7, precision: 0.31 }, ["nova-7", "kx_bench"], 0.03, 22),
    tolerance: 1e-3,
    detail: {
      status: "verifying",
      submittedAt: T("09:41"),
      buildSha256: SHA("3ba7c19e04d5f6a2b8e"),
      gpu: RTX4090,
      runtimeS: 6.8,
      approval: fee("Lm4nBv7cXz1qWe9rTy3uIo6pAs2dFg8h"),
      draw: { source: "Qw2eRt4yUi6oPa8sDf1gHj3kLz5xCv7b" },
      quorum: 3,
      harness: false,
      harnessRunning: false,
      verifiers: [
        report("nova-7", `${RTX4090} + AMD Ryzen 9 7950X`, 1.41, 3.12, 2.21, true, "all runs faster than baseline, beyond the noise (±3.1%)", 6),
        report("kx_bench", `${RTX4090} + Intel Core i9-13900K`, 1.38, 3.05, 2.21, true, "faster on every run (±2.6% noise)", 6),
        { who: "gpuwitch", hardware: `${RTX4090} + AMD Ryzen 7 7800X3D`, reported: false },
      ],
      outcome: null,
      feeSettlement: null,
    },
  },
  {
    id: "video",
    set: "harness",
    label: "Video",
    workload: "Motion estimation · SAD",
    hardware: RTX4060L,
    model: "AV1 encode · 1080p60",
    track: "me-sad-16x16",
    kernel: { name: "SAD 16×16 · shared-memory tiles", rank: null, of: 11 },
    baseline: B4060,
    top1: scale(B4060, { speed: 0.55, best: 0.55, worst: 0.58, cold: 0.7, noise: 0.5, precision: 0.1 }),
    // Barely different from the baseline, and noisier.
    runs: mkRuns(B4060, { speed: 0.97, best: 0.96, worst: 1.03, cold: 1.1, noise: 1.6, precision: 0.6 }, ["ferrite", "lowpoly"], 0.04, 33),
    tolerance: 1e-3,
    detail: {
      status: "rejected",
      submittedAt: T("06:03"),
      buildSha256: SHA("c41d9e2f7a30b6d58e1"),
      gpu: RTX4060L,
      runtimeS: 3.9,
      approval: fee("Pa3sDf5gHj7kLz9xCv1bNm2qWe4rTy6u"),
      draw: { source: "server" },
      quorum: 2,
      harness: false,
      harnessRunning: false,
      verifiers: [
        report("ferrite", "NVIDIA GeForce RTX 4060 + Intel Core i5-13400F", 1.05, 4.21, 4.01, false, "gain is inside the noise band (±6.8%)", 5),
        report("lowpoly", `${RTX4060L} + AMD Ryzen 7 7840HS`, 0.98, 4.4, 4.49, false, "slower than baseline on 3 of 5 runs", 5),
        {
          who: "sm89only",
          hardware: "NVIDIA GeForce RTX 4070",
          reported: true,
          incompatible: "build targets sm_89 only; verifier GPU exposes sm_86 in this driver",
        },
      ],
      outcome: { speedup: 1.02, at: T("06:19") },
      feeSettlement: { digest: "Ty2uIo4pAs6dFg8hJk1lZx3cVb5nMq7w", recipients: 2, amountSui: 0.01 },
    },
  },
  {
    id: "inference",
    set: "harness",
    label: "LLM Inference",
    workload: "Paged KV-cache attention",
    hardware: "Apple M3 Max",
    model: "Qwen2.5-7B Q8_0",
    track: "paged-attn-128",
    kernel: { name: "Paged attention · simdgroup matmul", rank: 3, of: 12 },
    baseline: BM3,
    top1: scale(BM3, { speed: 0.52, best: 0.52, worst: 0.54, cold: 0.6, noise: 0.5, precision: 0.05 }),
    runs: mkRuns(BM3, { speed: 0.62, best: 0.61, worst: 0.64, cold: 0.7, noise: 0.7, precision: 0.2 }, ["metalhead", "q8"], 0.03, 44),
    tolerance: 1e-3,
    detail: {
      status: "verified",
      submittedAt: "2026-09-18T22:07:00+08:00",
      buildSha256: SHA("8e2a5c7d1f09b34e6a2"),
      gpu: "Apple M3 Max (40-core GPU)",
      runtimeS: 5.1,
      approval: null, // made before approvals and fees existed
      draw: { source: "server" },
      quorum: 2,
      harness: false,
      harnessRunning: false,
      verifiers: [
        report("metalhead", "Apple M3 Max 40-core · 64 GB", 1.62, 7.8, 4.81, true, "every run beat the baseline (±2.2% noise)", 5),
        report("q8", "Apple M3 Max 30-core · 36 GB", 1.59, 8.1, 5.09, true, "every run beat the baseline (±2.9% noise)", 5),
      ],
      outcome: { speedup: 1.62, at: "2026-09-18T22:31:00+08:00" },
      feeSettlement: null,
    },
  },
  {
    id: "imagegen",
    set: "harness",
    label: "Image Gen",
    workload: "Conv2d · Winograd F(4,3)",
    hardware: RTX4090,
    model: "SDXL UNet · 1024²",
    track: "conv2d-winograd",
    kernel: { name: "Winograd F(4,3) · tensor-core transform", rank: null, of: 7 },
    baseline: B4090,
    top1: scale(B4090, { speed: 0.66, best: 0.66, worst: 0.68, cold: 0.75, noise: 0.6, precision: 0.1 }),
    runs: [],
    tolerance: 1e-3,
    detail: {
      status: "pending",
      submittedAt: T("10:02"),
      buildSha256: SHA("5d0e8a3b9c72f14e6b0"),
      gpu: RTX4090,
      runtimeS: 11.3,
      approval: fee("Vb6nMq8wEr1tYu3iOp5aSd7fGh9jKl2z"),
      draw: null,
      quorum: 3,
      harness: false,
      harnessRunning: false,
      verifiers: [],
      outcome: null,
      feeSettlement: null,
    },
  },
  {
    id: "science",
    set: "harness",
    label: "Scientific / HPC",
    workload: "FP64 SpMV · CSR",
    hardware: RTX4090,
    model: "CSR 12M nnz · double",
    track: "spmv-csr-fp64",
    kernel: { name: "SpMV CSR · merge-path load balance", rank: 4, of: 8 },
    baseline: B4090,
    top1: scale(B4090, { speed: 0.72, best: 0.72, worst: 0.74, cold: 0.8, noise: 0.6, precision: 0.1 }),
    // High variance on the cold start, noisier than the baseline.
    runs: mkRuns(
      B4090,
      { speed: 0.79, best: 0.78, worst: 0.82, cold: 0.95, noise: 1.3, precision: 0.4 },
      ["nova-7", "kx_bench", "Platform harness", "ferrite"],
      0.03,
      66,
      { cold: 0.16 },
    ),
    tolerance: 1e-3,
    detail: {
      status: "verified",
      submittedAt: "2026-09-25T18:44:00+08:00",
      buildSha256: SHA("a97e3c1d5f2b804e7c6"),
      gpu: RTX4090,
      runtimeS: 8.7,
      approval: fee("Gh2jKl4zXc6vBn8mQw1eRt3yUi5oPa7s"),
      draw: { source: "Kl3zXc5vBn7mQw9eRt2yUi4oPa6sDf8g" },
      quorum: 3,
      harness: true,
      harnessRunning: false,
      verifiers: [
        report("nova-7", `${RTX4090} + AMD Ryzen 9 7950X`, 1.29, 12.4, 9.61, true, "faster on every run (±4.1% noise)", 6),
        report("kx_bench", `${RTX4090} + Intel Core i9-13900K`, 1.24, 12.1, 9.76, true, "faster on every run (±3.8% noise)", 6),
        report("Platform harness", `${RTX4090} + AMD EPYC 7443P`, 1.31, 12.7, 9.69, true, "faster on every run (±2.4% noise)", 8),
        report("ferrite", `${RTX4090} + Intel Core i5-13400F`, 1.19, 13.6, 11.4, true, "faster on 6 of 6 runs; thermal throttling widened the noise (±9.5%)", 6),
      ],
      outcome: { speedup: 1.27, at: "2026-09-25T19:20:00+08:00" },
      feeSettlement: { digest: "Xc7vBn9mQw2eRt4yUi6oPa8sDf1gHj3k", recipients: 4, amountSui: 0.01 },
    },
  },
];
