/** Page 1: what the user wants their hardware to do. */
export type Task = {
  id: string;
  name: string;
  detail: string;
  available: boolean;
};

export const TASKS: Task[] = [
  {
    id: "zk-groth16",
    name: "ZK proving",
    detail: "Generate Groth16 proofs (BN254). The heaviest part is MSM and FFT, which is where a GPU helps.",
    available: true,
  },
  {
    id: "hash-batch",
    name: "Batch hashing",
    detail: "SHA-256 / Keccak over millions of inputs, e.g. commitments and airdrop lists.",
    available: false,
  },
  {
    id: "merkle",
    name: "Merkle trees",
    detail: "Build and update large Merkle trees for rollups and allowlists.",
    available: false,
  },
  {
    id: "sig-verify",
    name: "Signature checks",
    detail: "Verify batches of ECDSA / BLS signatures.",
    available: false,
  },
];

/** Page 2: a fixed workload tuners compete on. One track = one leaderboard. */
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
    id: "video-1080p-2min",
    name: "Video render",
    category: "Media",
    summary: "Render the same 2-minute 1080p clip as fast as possible. Same output, less time.",
    spec: [
      ["Clip", "2 min test pattern + 440 Hz tone (ffmpeg testsrc2)"],
      ["Output", "1920×1080, 30 fps, H.264, 3,600 frames"],
      ["Check", "Output stream matches the reference exactly"],
      ["Hardware", "Reported by the agent (GPU, driver, CPU)"],
    ],
    metric: "Render time (s)",
  },
  {
    id: "ens-namehash",
    name: "ENS names",
    category: "ENSv2 · Sepolia",
    summary: "Compute ENS namehash + SHA-256 for 1M names. Winning builds are published as ENSv2 subnames on Sepolia.",
    spec: [
      ["Input", "1,000,000 names, fixed list"],
      ["Output", "namehash + SHA-256 per name"],
      ["Check", "Output root matches the reference"],
      ["Publish", "<tuner>.vtec.eth on ENSv2 Sepolia"],
    ],
    metric: "Time (s)",
  },
];

export function findTrack(id: string) {
  return TRACKS.find((track) => track.id === id) ?? null;
}
