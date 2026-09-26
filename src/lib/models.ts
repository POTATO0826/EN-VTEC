import { SPOKE_SETS, type Metrics, type ResultEntry, type VerifierRun } from "./results";

/**
 * Local AI models and the GPU workloads people tune kernels for. Everything
 * about a model is real catalogue data; the per-workload numbers, kernels
 * and history are SAMPLE data generated from a seed, labelled as such, until
 * a track measures them. Where a workload has a real track, the verified
 * submissions on it are merged in by /api/models/<id>.
 */

export type WorkloadId = "inference" | "coding" | "imagegen" | "video" | "render" | "science";

export type Workload = { id: WorkloadId; label: string; workload: string };

export const WORKLOADS: Workload[] = [
  { id: "inference", label: "LLM Inference", workload: "Decode · paged KV-cache attention" },
  { id: "coding", label: "Coding", workload: "Code assist · long-context decode" },
  { id: "imagegen", label: "Image Gen", workload: "Diffusion · Conv2d Winograd" },
  { id: "video", label: "Video", workload: "Video understanding · frame encode" },
  { id: "render", label: "3D Rendering", workload: "Scene reasoning · ray–triangle" },
  { id: "science", label: "Scientific / HPC", workload: "Tool calls · FP64 SpMV" },
];

export const findWorkload = (id: string) => WORKLOADS.find((w) => w.id === id) ?? null;

export type Model = {
  id: string;
  name: string;
  vendor: string;
  params: string;
  active: string;
  quant: string;
  contextK: number;
  sizeGb: number;
  license: string;
  summary: string;
  tags: string[];
  /** The reference machine the sample numbers describe. */
  hardware: string;
  /** Which workloads have a real track on this platform, by track id. */
  tracks: Partial<Record<WorkloadId, string>>;
  /** Sample status per workload; a workload without one is pending. */
  status: Partial<Record<WorkloadId, "verified" | "rejected">>;
};

const RTX4060L = "NVIDIA GeForce RTX 4060 Laptop GPU";
const RTX4090 = "NVIDIA GeForce RTX 4090";
const M3U = "Apple M3 Ultra · 512 GB";

export const MODELS: Model[] = [
  {
    id: "kimi-k3",
    name: "Kimi K3",
    vendor: "Moonshot AI",
    params: "1T MoE",
    active: "32B active",
    quant: "Q3_K_M",
    contextK: 256,
    sizeGb: 452,
    license: "Modified MIT",
    summary: "Moonshot's newest mixture-of-experts. Agentic coding and long-context reasoning; runs locally on a 512 GB unified-memory machine.",
    tags: ["agentic", "coding", "256K context"],
    hardware: M3U,
    tracks: {},
    status: { inference: "verified", coding: "verified", science: "verified", video: "rejected" },
  },
  {
    id: "kimi-k2",
    name: "Kimi K2",
    vendor: "Moonshot AI",
    params: "1T MoE",
    active: "32B active",
    quant: "Q3_K_M",
    contextK: 128,
    sizeGb: 431,
    license: "Modified MIT",
    summary: "The open-weights K2 mixture-of-experts. Strong at tool use and code; the model most people run on a Mac Studio.",
    tags: ["tool use", "coding", "MoE"],
    hardware: M3U,
    tracks: {},
    status: { inference: "verified", coding: "verified", render: "rejected" },
  },
  {
    id: "qwen3-8b",
    name: "Qwen3 8B",
    vendor: "Alibaba",
    params: "8.2B",
    active: "dense",
    quant: "Q4_K_M",
    contextK: 128,
    sizeGb: 5.0,
    license: "Apache 2.0",
    summary: "The 8B Qwen3 with thinking mode. Fits an 8 GB laptop GPU at Q4 and shares the 4096-wide RMSNorm with Llama-class models.",
    tags: ["thinking", "8 GB GPU", "multilingual"],
    hardware: RTX4060L,
    tracks: { inference: "rmsnorm-4096", coding: "rmsnorm-4096" },
    status: { inference: "verified", coding: "verified", imagegen: "rejected" },
  },
  {
    id: "llama-3.1-8b",
    name: "Llama 3.1 8B",
    vendor: "Meta",
    params: "8.0B",
    active: "dense",
    quant: "Q4_K_M",
    contextK: 128,
    sizeGb: 4.9,
    license: "Llama 3.1 Community",
    summary: "The reference local model. Its RMSNorm runs twice per layer, which is exactly the kernel this platform's first track tunes.",
    tags: ["reference", "8 GB GPU", "RMSNorm track"],
    hardware: RTX4060L,
    tracks: { inference: "rmsnorm-4096", coding: "rmsnorm-4096" },
    status: { inference: "verified", coding: "verified", science: "verified" },
  },
  {
    id: "deepseek-r1-14b",
    name: "DeepSeek R1 14B",
    vendor: "DeepSeek",
    params: "14.8B",
    active: "dense (distilled)",
    quant: "Q5_K_M",
    contextK: 128,
    sizeGb: 10.5,
    license: "MIT",
    summary: "The Qwen-distilled R1 reasoner. Long chains of thought, so decode throughput and p99 latency matter more than prefill.",
    tags: ["reasoning", "24 GB GPU", "distilled"],
    hardware: RTX4090,
    tracks: {},
    status: { inference: "verified", science: "verified", coding: "rejected" },
  },
  {
    id: "gemma-3-27b",
    name: "Gemma 3 27B",
    vendor: "Google",
    params: "27B",
    active: "dense · vision",
    quant: "Q4_K_M",
    contextK: 128,
    sizeGb: 16.5,
    license: "Gemma Terms",
    summary: "Multimodal Gemma at 27B. Image and video understanding on a single 24 GB card, with a vision tower the diffusion kernels also serve.",
    tags: ["vision", "24 GB GPU", "multimodal"],
    hardware: RTX4090,
    tracks: {},
    status: { imagegen: "verified", video: "verified", inference: "verified" },
  },
];

export const findModel = (id: string) => MODELS.find((m) => m.id === id) ?? null;

/** Where a submission on a track is shown: the first model that maps the track, on that workload. */
export function submissionHref(trackId: string, submissionId: string) {
  for (const m of MODELS) {
    for (const [workload, track] of Object.entries(m.tracks)) {
      if (track === trackId) return `/models/${m.id}/kernels/${submissionId}?workload=${workload}`;
    }
  }
  return "/models";
}

/* -------------------------------------------------------------------------- */
/* Sample generation                                                           */
/* -------------------------------------------------------------------------- */

function seedOf(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MODEL_SPOKES = SPOKE_SETS.model.spokes;

/** Baseline numbers for the model's reference machine, scaled by model size. */
function baselineOf(model: Model): Metrics {
  const rig: Record<string, Metrics> = {
    [RTX4060L]: { tpm: 1980, energy: 0.31, speed: 412, p99: 88, prefill: 640, tps: 34.5 },
    [RTX4090]: { tpm: 8400, energy: 0.115, speed: 96, p99: 21, prefill: 3900, tps: 142 },
    [M3U]: { tpm: 2600, energy: 0.17, speed: 330, p99: 61, prefill: 820, tps: 46 },
  };
  const base = rig[model.hardware] ?? rig[RTX4090];
  // Bigger active weights: slower decode, more energy per token.
  const k = model.sizeGb > 100 ? 0.55 : model.sizeGb > 12 ? 0.6 : model.sizeGb > 8 ? 0.8 : 1;
  return Object.fromEntries(
    MODEL_SPOKES.map((s) => [s.key, base[s.key]! * (s.lower ? 1 / k : k)]),
  );
}

const scale = (base: Metrics, m: Metrics) => Object.fromEntries(MODEL_SPOKES.map((s) => [s.key, base[s.key]! * m[s.key]!]));

const WHO = ["nova-7", "kx_bench", "ferrite", "lowpoly", "metalhead", "q8", "tensorbae", "Platform harness"];
const T0 = Date.parse("2026-09-26T10:00:00+08:00");
const day = 86400e3;

export type KernelRow = {
  id: string;
  modelId: string;
  workloadId: WorkloadId;
  name: string;
  tuner: string | null;
  buildSha256: string;
  speedup: number;
  verifiers: { passed: number; total: number };
  harness: boolean;
  listing: { id: string; digest: string; lineage: string; royalties?: string } | null;
  status: "verified" | "rejected" | "verifying";
  submittedAt: string;
  /** True for generated rows; false for a verified submission from the store. */
  sample: boolean;
  trackId: string | null;
};

const KERNEL_NAMES: Record<WorkloadId, string[]> = {
  inference: ["Paged attention · simdgroup matmul", "RMSNorm · float4 + warp shuffle", "Fused RoPE + KV write", "GQA decode · split-K", "Flash decode · tile 64", "RMSNorm · auto-tuned (threads=512)"],
  coding: ["Speculative decode · 4-token draft", "RMSNorm · float4 + warp shuffle", "Prefix-cache attention", "Long-context KV compaction", "RMSNorm · auto-tuned (threads=256)"],
  imagegen: ["Winograd F(4,3) · tensor-core transform", "Conv2d · implicit GEMM", "GroupNorm · fused SiLU", "Attention · flash v2 tiles", "Upsample · nearest fused"],
  video: ["SAD 16×16 · shared-memory tiles", "Motion vectors · warp-coherent", "Frame delta · int8", "Patch embed · fused"],
  render: ["Möller–Trumbore SIMT · tuned (warp-coherent)", "BVH traversal · persistent threads", "Shading · sorted by material"],
  science: ["SpMV CSR · merge-path load balance", "FP64 GEMM · tensor-core emulation", "Stencil 7-pt · shared tiles", "Reduction · warp shuffle"],
};

const hex = (r: () => number, n: number) => Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(r() * 16)]).join("");
const digest = (r: () => number) => Array.from({ length: 44 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789"[Math.floor(r() * 57)]).join("");

/** The generated kernels on one model × workload leaderboard, fastest first. */
export function sampleKernels(model: Model, workloadId: WorkloadId): KernelRow[] {
  const r = rng(seedOf(`${model.id}:${workloadId}:kernels`));
  const status = model.status[workloadId];
  const names = KERNEL_NAMES[workloadId];
  const n = status ? Math.min(names.length, 3 + Math.floor(r() * 3)) : 0;
  const rows: KernelRow[] = [];
  for (let i = 0; i < n; i++) {
    const total = 1 + Math.floor(r() * 4);
    const rejected = status === "rejected" && i === n - 1;
    const passed = rejected ? Math.floor(total / 2) : total;
    const harness = total === 1 || r() < 0.3;
    rows.push({
      id: `k_${hex(r, 12)}`,
      modelId: model.id,
      workloadId,
      name: names[i],
      tuner: `0x${hex(r, 64)}`,
      buildSha256: hex(r, 64),
      speedup: Math.round((1.15 + r() * 1.4) * 100) / 100,
      verifiers: { passed, total },
      harness,
      listing: null,
      status: rejected ? "rejected" : "verified",
      submittedAt: new Date(T0 - (i + 1) * (1 + r() * 3) * day).toISOString(),
      sample: true,
      trackId: model.tracks[workloadId] ?? null,
    });
  }
  return rows.sort((a, b) => (b.status === "verified" ? b.speedup : 0) - (a.status === "verified" ? a.speedup : 0));
}

/** The model's hexagon on one workload: its best verified kernel vs the stock baseline. */
export function modelEntry(model: Model, workloadId: WorkloadId): ResultEntry {
  const w = findWorkload(workloadId)!;
  const r = rng(seedOf(`${model.id}:${workloadId}`));
  const status = model.status[workloadId] ?? "pending";
  const baseline = baselineOf(model);
  const gain = status === "verified" ? 0.35 + r() * 0.5 : status === "rejected" ? 0.02 + r() * 0.06 : 0;
  const m = (k: number) => 1 + gain * k;
  const mult = { tpm: m(1.5), energy: 1 / m(1.1), speed: 1 / m(1.6), p99: 1 / m(1.2), prefill: m(1.1), tps: m(1.55) };
  const top = { tpm: m(1.75), energy: 1 / m(1.3), speed: 1 / m(1.85), p99: 1 / m(1.4), prefill: m(1.3), tps: m(1.8) };
  const kernels = sampleKernels(model, workloadId);
  const best = kernels.find((k) => k.status === "verified") ?? kernels[0] ?? null;
  const who = best ? WHO.slice(0, best.verifiers.total) : [];
  const jitter = status === "rejected" ? 0.05 : 0.03;
  const runs =
    status === "pending"
      ? []
      : who.map((name) => ({
          who: name,
          metrics: Object.fromEntries(MODEL_SPOKES.map((s) => [s.key, baseline[s.key]! * mult[s.key as keyof typeof mult] * (1 + (r() - 0.5) * 2 * jitter)])),
        }));
  const verifiers: VerifierRun[] = who.map((name, i) => {
    const base = 4 + r() * 6;
    const sp = best!.speedup * (1 + (r() - 0.5) * 0.06);
    return {
      who: name,
      hardware: model.hardware,
      reported: true,
      report: {
        speedup: Math.round(sp * 100) / 100,
        baselineS: Math.round(base * 100) / 100,
        candidateS: Math.round((base / sp) * 100) / 100,
        pass: status === "verified" || i < best!.verifiers.passed,
        reason: status === "verified" ? `${sp.toFixed(2)}× faster: every run beat the baseline (±${(1 + r() * 4).toFixed(1)}% noise).` : `${sp.toFixed(2)}× is inside this machine's noise band.`,
        runs: 4 + Math.floor(r() * 3),
        identical: true,
      },
    };
  });
  return {
    id: workloadId,
    set: "model",
    label: w.label,
    workload: w.workload,
    track: model.tracks[workloadId] ?? `${workloadId}-sample`,
    model: `${model.name} ${model.quant}`,
    hardware: model.hardware,
    kernel: { name: best?.name ?? "No kernel verified yet", rank: best && best.status === "verified" ? 1 : null, of: kernels.length },
    baseline,
    top1: scale(baseline, top),
    runs,
    detail: {
      status,
      submittedAt: best?.submittedAt ?? new Date(T0 - day).toISOString(),
      buildSha256: best?.buildSha256 ?? hex(r, 64),
      gpu: model.hardware,
      runtimeS: 2 + r() * 8,
      approval: { worldId: true, fee: { digest: digest(r), amountSui: 0.01 } },
      draw: status === "pending" ? null : { source: digest(r) },
      quorum: Math.min(3, who.length || 3),
      harness: !!best?.harness,
      harnessRunning: false,
      verifiers,
      outcome: status === "pending" ? null : { speedup: best?.speedup ?? null, at: best?.submittedAt ?? new Date(T0).toISOString() },
      feeSettlement: status === "pending" ? null : { digest: digest(r), recipients: who.length, amountSui: 0.01 },
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Kernel detail (sample)                                                      */
/* -------------------------------------------------------------------------- */

export type HistoryEntry = {
  at: string;
  note: string;
  fullNote: string;
  status: "verified" | "rejected" | "pending";
  /** Decode tokens per second after this submission. */
  score: number;
  landed: boolean;
};

export type KernelDetailData = {
  row: KernelRow;
  /** This kernel's own hexagon, on the model set. */
  entry: ResultEntry;
  harness: {
    gpu: string;
    cpu: string;
    driver: string;
    model: string;
    runs: number;
    noisePct: number;
    /** Energy the harness metered per verification run, and the average draw. */
    energyPerRunJ: number | null;
    avgPowerW: number | null;
    durationS: number;
  };
  contract: {
    listingId: string | null;
    listingTx: string | null;
    licenseSui: number;
    split: [tuner: number, lineage: number, platform: number];
    lineage: string | null;
    feeTx: string | null;
    settlementTx: string | null;
    worldId: boolean;
    licensesSold: number | null;
  };
  kernel: { buildSha256: string; specSha256: string; resultSha256: string; files: number; run: string };
  history: HistoryEntry[];
};

const CPUS = ["Intel(R) Core(TM) i7-14650HX", "AMD Ryzen 9 7950X", "Intel Core i9-13900K", "Apple M3 Ultra 32-core"];

export function sampleDetail(model: Model, workloadId: WorkloadId, kernelId: string): KernelDetailData | null {
  const rows = sampleKernels(model, workloadId);
  const row = rows.find((k) => k.id === kernelId);
  if (!row) return null;
  const r = rng(seedOf(`${model.id}:${workloadId}:${kernelId}:detail`));
  const base = modelEntry(model, workloadId);
  const rank = rows.indexOf(row) + 1;
  // The kernel's own gain: rank #1 matches the workload's best, the rest fall off a little.
  const k = 1 - (rank - 1) * 0.12;
  // Each spoke sits k of the way from the baseline (×1) to the board's best (×bestMult).
  const mult = Object.fromEntries(
    MODEL_SPOKES.map((s) => {
      const bestMult = base.top1[s.key]! / base.baseline[s.key]!;
      return [s.key, 1 + (bestMult - 1) * k];
    }),
  );
  const entry: ResultEntry = {
    ...base,
    id: row.id,
    kernel: { name: row.name, rank: row.status === "verified" ? rank : null, of: rows.length },
    runs: WHO.slice(0, row.verifiers.total).map((who) => ({
      who,
      metrics: Object.fromEntries(MODEL_SPOKES.map((s) => [s.key, base.baseline[s.key]! * mult[s.key] * (1 + (r() - 0.5) * 0.05)])),
    })),
    detail: { ...base.detail, status: row.status, buildSha256: row.buildSha256, submittedAt: row.submittedAt, harness: row.harness, outcome: { speedup: row.speedup, at: row.submittedAt } },
  };
  const duration = 2 + r() * 6;
  const power = model.hardware === M3U ? 90 + r() * 60 : model.hardware === RTX4090 ? 280 + r() * 120 : 60 + r() * 45;
  const history: HistoryEntry[] = [];
  const tps0 = base.baseline.tps!;
  // The history ends where this kernel's verified decode rate is.
  const tpsRuns = entry.runs.map((x) => x.metrics.tps!).sort((a, b) => a - b);
  const tpsFinal = tpsRuns[tpsRuns.length >> 1] ?? tps0;
  const steps = 3 + Math.floor(r() * 3);
  for (let i = steps - 1; i >= 0; i--) {
    const landed = i === 0 ? row.status === "verified" : r() < 0.7;
    const notes = [
      [`${row.name.split(" · ")[0]}: first port of the public kernel`, "Ported the reference implementation as-is to get a verified baseline on this hardware. No tuning yet; the harness confirmed identical output on every seed."],
      ["Vectorised loads and a warp-shuffle reduction", "Replaced the shared-memory tree with __shfl_xor_sync and moved to float4 loads, cutting memory transactions 4×. Output identical within 1e-3."],
      ["Retuned block size for this GPU's SM count", "Auto-tuner swept threads ∈ {128, 256, 512, 1024} and load path ∈ {plain, __ldg}; kept the fastest correct variant. Verifiers reproduced it on their own cards."],
      ["Fused the epilogue and removed one sync", "The output pass now reuses the row already in registers; one __syncthreads fewer per row. Small but consistent across seeds."],
      ["Another measured draw of the same image", "Same build, re-verified after the pool grew: three independent machines instead of the platform harness."],
    ];
    const [note, fullNote] = notes[(steps - 1 - i) % notes.length];
    history.push({
      at: new Date(Date.parse(row.submittedAt) - i * (1 + r() * 2) * day).toISOString(),
      note,
      fullNote,
      status: landed ? "verified" : "rejected",
      score: tps0 + (tpsFinal - tps0) * (1 - i / steps) * (landed ? 1 : 0.6),
      landed,
    });
  }
  return {
    row,
    entry,
    harness: {
      gpu: model.hardware,
      cpu: CPUS[Math.floor(r() * CPUS.length)],
      driver: model.hardware === M3U ? "Metal 4" : `${560 + Math.floor(r() * 20)}.${Math.floor(r() * 99)}`,
      model: `${model.name} · ${model.quant} · ${model.contextK}K context`,
      runs: 4 + Math.floor(r() * 3),
      noisePct: Math.round((1 + r() * 4) * 10) / 10,
      energyPerRunJ: Math.round(power * duration),
      avgPowerW: Math.round(power),
      durationS: Math.round(duration * 100) / 100,
    },
    contract: {
      listingId: row.status === "verified" ? `0x${hex(r, 64)}` : null,
      listingTx: row.status === "verified" ? digest(r) : null,
      licenseSui: 0.1,
      split: [70, 20, 10],
      lineage: rank > 1 ? rows[rank - 2].tuner : row.tuner,
      feeTx: digest(r),
      settlementTx: digest(r),
      worldId: true,
      licensesSold: row.status === "verified" ? Math.floor(r() * 40) : 0,
    },
    kernel: {
      buildSha256: row.buildSha256,
      specSha256: hex(r, 64),
      resultSha256: hex(r, 64),
      files: 2 + Math.floor(r() * 3),
      run: "{python} kernel.py",
    },
    history,
  };
}
