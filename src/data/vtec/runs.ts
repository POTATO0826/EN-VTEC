import type {
  Candidate,
  GPU,
  Run,
  TestPlan,
  VariantId,
} from "./types";
import { variantName, VARIANTS } from "./variants";

/* -------------------------------------------------------------------------- */
/* Deterministic helpers                                                       */
/* -------------------------------------------------------------------------- */

/** Stable PRNG so fixtures render identically on the server and in the browser. */
function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/** Plausible, stable-looking hex for simulated transactions and fingerprints. */
export function fakeHex(seed: string, nibbles: number): string {
  const rnd = seeded(seed);
  let out = "0x";
  for (let i = 0; i < nibbles; i += 1) {
    out += Math.floor(rnd() * 16).toString(16);
  }
  return out;
}

/**
 * Builds the individual run values behind a median.
 *
 * The first run is a warm-up and is discarded; what is left is an odd number of
 * values whose median is exactly the median we quote. The scatter is scaled by
 * the machine's measured noise band, so a noisy card visibly produces noisy
 * numbers in the node detail sheet.
 */
export function buildTimings(
  seed: string,
  medianMs: number,
  noiseBandPct: number,
  runsPerMeasurement: number,
) {
  const keep = runsPerMeasurement - 1;
  const rnd = seeded(seed);
  const spread = (medianMs * noiseBandPct) / 100;
  const centre = (keep - 1) / 2;
  const values: number[] = [];
  for (let i = 0; i < keep; i += 1) {
    const base = (i - centre) / centre;
    values.push(
      Number((medianMs + base * spread * (0.7 + 0.6 * rnd())).toFixed(3)),
    );
  }
  // Shuffle for display; the median of the multiset is unchanged.
  for (let i = values.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const stdev = Math.sqrt(
    values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length,
  );
  return {
    runs: values,
    medianMs,
    stdevMs: Number(stdev.toFixed(3)),
    warmupMs: Number((medianMs * (1 + noiseBandPct / 100) * 1.34).toFixed(3)),
  };
}

/* -------------------------------------------------------------------------- */
/* Hardware                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One card. The build plan is a single-laptop build (section 2), and section 0's
 * checkpoint is explicit: cross-hardware claims are out of scope unless the
 * optional second card in appendix A is actually run. Five other GPUs used to
 * live here and were removed rather than relabelled, because a grid of cards
 * with speedups on them reads as a measured network however it is captioned.
 *
 * Values marked verified came from `nvidia-smi` on this machine. The rest are
 * still fixtures and are not to be quoted.
 */
export const GPUS: GPU[] = [
  {
    id: "rtx4060",
    name: "RTX 4060 Laptop GPU", // verified
    vramMb: 8188, // verified
    smCount: 24, // the crossover spike reports this; not yet confirmed here
    l2CacheMb: 24, // not verified
    computeCapability: "8.9", // verified
    driverVersion: "566.26", // verified
    hwFingerprint: fakeHex("fp-rtx4060", 64),
    status: "online",
    // Section 6a makes these part of the hardware scope. Null until M0 records
    // `nvidia-smi -q -d POWER`; the UI shows "not recorded" rather than a guess.
    powerLimitW: null,
    powerMode: null,
  },
];

export const GPU_BY_ID: Record<string, GPU> = Object.fromEntries(
  GPUS.map((gpu) => [gpu.id, gpu]),
);

/* -------------------------------------------------------------------------- */
/* Plans                                                                       */
/* -------------------------------------------------------------------------- */

const BATCH_SIZES = [65536, 262144, 1048576, 2097152];

function plan(overrides: Partial<TestPlan> = {}): TestPlan {
  return {
    task: "sha256",
    messageLengthBytes: 4096,
    batchSizes: BATCH_SIZES,
    variantPool: ["A", "B", "C", "D", "E"],
    baselineVariant: "A",
    runsPerMeasurement: 8,
    targetMsPerMeasurement: 20,
    oracle: { name: "Python's hashlib", vectors: 1000, boundaries: [55, 56, 64] },
    acceptanceRule: "beats-baseline-by-more-than-noise-band",
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* Candidate helpers                                                           */
/* -------------------------------------------------------------------------- */

function candidate(
  runId: string,
  variant: VariantId,
  verdict: Candidate["verdict"],
  reason: string,
  opts: {
    medianMs?: number;
    baselineMs?: number;
    noiseBand?: number;
    runsPerMeasurement?: number;
    correct?: boolean;
  } = {},
): Candidate {
  const correct = opts.correct ?? verdict !== "failed";
  const timings =
    opts.medianMs !== undefined && opts.noiseBand !== undefined
      ? buildTimings(
          `${runId}-${variant}`,
          opts.medianMs,
          opts.noiseBand,
          opts.runsPerMeasurement ?? 8,
        )
      : undefined;
  const speedup =
    opts.medianMs !== undefined && opts.baselineMs !== undefined
      ? Number((opts.baselineMs / opts.medianMs).toFixed(4))
      : undefined;
  const gainPct =
    opts.medianMs !== undefined && opts.baselineMs !== undefined
      ? Number(
          (((opts.baselineMs - opts.medianMs) / opts.baselineMs) * 100).toFixed(
            2,
          ),
        )
      : undefined;
  return {
    variant,
    label: VARIANTS[variant].label,
    correct,
    medianMs: opts.medianMs,
    speedup,
    gainPct,
    verdict,
    reason,
    timings: timings
      ? {
          runs: timings.runs,
          medianMs: timings.medianMs,
          stdevMs: timings.stdevMs,
        }
      : undefined,
    warmupMs: timings?.warmupMs,
  };
}

/* -------------------------------------------------------------------------- */
/* Runs                                                                        */
/* -------------------------------------------------------------------------- */

const r3 = "rtx4060-sha256-1m";

/**
 * PLACEHOLDER. Not measured.
 *
 * Every number below is a typed fixture and stays one until the crossover spike
 * (build plan section 11a) has run twice on this machine under the section 6a
 * protocol. Section 0 rule 7 forbids writing a claim about why a variant wins
 * before it matches measured numbers, so nothing here may be quoted in the UI,
 * the pitch, or the demo until `artifacts/spike/` holds two agreeing runs.
 */
export const RUNS: Run[] = [
  {
    id: r3,
    gpuId: "rtx4060",
    task: "sha256",
    status: "verified",
    createdAt: "2026-09-15T18:02:00.000Z",
    headlineJobSize: 1048576,
    noiseBand: 4.2,
    plan: plan({
      oracle: {
        name: "Python's hashlib",
        vectors: 1500,
        boundaries: [55, 56, 64],
      },
    }),
    planHash: "0x5b0965f7f0832a2ba3a85096ce3e1999d7220b74bd4b8f831000f4445d771a17",
    commitTx: fakeHex(`${r3}-commit`, 64),
    revealTx: fakeHex(`${r3}-reveal`, 64),
    chain: "Base",
    committedBy: "passkey",
    ensName: "rtx4060.sha256.gpuvtec.eth",
    curves: {
      A: [22.4, 84.6, 335.0, null],
      B: [13.0, 50.4, 219.4, null],
      C: [16.8, 52.9, 176.3, null],
      D: [18.9, 61.7, 206.0, null],
      E: [29.9, 112.0, 441.7, null],
    },
    skipped: [
      { jobSize: 2097152, reason: "needs 8.6 GB, only 7.4 GB free" },
    ],
    candidates: [
      candidate(
        r3,
        "B",
        "rejected",
        `correct and clear of the band, but 1.24× slower than ${variantName("C")}`,
        { medianMs: 219.4, baselineMs: 335.0, noiseBand: 4.2 },
      ),
      candidate(
        r3,
        "C",
        "accepted",
        "1.90× baseline, clear of the 4.2% noise band",
        { medianMs: 176.3, baselineMs: 335.0, noiseBand: 4.2 },
      ),
      candidate(
        r3,
        "D",
        "rejected",
        `correct and clear of the band, but 1.17× slower than ${variantName("C")}`,
        { medianMs: 206.0, baselineMs: 335.0, noiseBand: 4.2 },
      ),
      candidate(r3, "E", "rejected", "slower than baseline: 0.76×", {
        medianMs: 441.7,
        baselineMs: 335.0,
        noiseBand: 4.2,
      }),
    ],
    dispatcher: {
      variant: "C",
      label: VARIANTS.C.label,
      medianMs: 176.3,
      speedup: 1.9,
      noiseBand: 4.2,
      reason:
        "With 24 SMs this card is saturated well before 1,048,576 messages, so the win comes from touching memory less rather than from more parallelism. variant C — warp-parallel schedule keeps the message schedule on-chip between rounds.",
      attestationTx: fakeHex(`${r3}-attest`, 64),
    },
    incoming: [],
    jobsPerHourBefore: 10746,
    jobsPerHourAfter: 20420,
    configPath: "~/.gpuvtec/registry/rtx4060-sha256.json",
  },
];
