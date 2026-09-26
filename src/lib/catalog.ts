/** Page 1: what the user wants their hardware to do. */
export type Task = {
  id: string;
  name: string;
  detail: string;
  available: boolean;
};

export const TASKS: Task[] = [
  {
    id: "local-ai",
    name: "Local AI kernels",
    detail: "Run LLM layers (RMSNorm, attention, matmul) faster on your own GPU with kernels tuned for your card.",
    available: true,
  },
  {
    id: "zk-groth16",
    name: "ZK proving",
    detail: "Groth16 proofs (BN254). The heavy parts, MSM and FFT, are GPU work.",
    available: false,
  },
];

/** Page 2: a fixed workload tuners compete on. One track = one challenge. */
export type Track = {
  id: string;
  name: string;
  category: string;
  summary: string;
  spec: [label: string, value: string][];
  metric: string;
};

export const TRACKS: Track[] = [
  {
    id: "rmsnorm-4096",
    name: "RMSNorm kernel",
    category: "Local AI · CUDA",
    summary:
      "The normalisation that runs twice in every Llama layer. Beat the generic version on your GPU with the same output.",
    spec: [
      ["Input", "8192 × 4096 fp32, random per run (seeded)"],
      ["Output", "y = x / √(mean(x²) + ε) · w"],
      ["Check", "Matches the baseline within 1e-3 on every seed"],
      ["Hardware", "NVIDIA GPU, driver 525+"],
    ],
    metric: "Time (s)",
  },
];

export function findTrack(id: string) {
  return TRACKS.find((track) => track.id === id) ?? null;
}
