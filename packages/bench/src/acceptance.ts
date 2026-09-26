/**
 * The "1% that is actually real" rule.
 *
 * README section 6: a build is promoted only if it (1) clears the track's
 * quality floor on hidden tasks, (2) beats the standing record by at least 1%
 * on the median of paired runs, and (3) still beats it by 1% in the pessimistic
 * case. Rule 3 is the one that matters. A GPU under a 30-second load does not
 * produce the same number twice: thermals drift, clocks boost and settle, the
 * OS schedules something else. A naive "+1% wins" leaderboard is therefore a
 * leaderboard of lucky runs, and every record on it is noise wearing a medal.
 *
 * The defence has two halves, and only one of them lives here:
 *
 *   * The *measurement* half is the verifier's job: run the standing record and
 *     the candidate back-to-back, alternating, so both see the same temperature
 *     and the same clocks. That turns machine-wide drift into something both
 *     sides suffer equally, which is what makes a per-pair ratio meaningful.
 *
 *   * The *statistics* half is this file: given those pairs, say how big the
 *     gain really is and how sure we are.
 *
 * On the choice of interval. With ten pairs and GPU timings that are skewed
 * (a thermal hiccup makes a run slower, never faster), the textbook t-interval
 * assumes a symmetry the data does not have. So the conservative number here is
 * the 2.5th percentile of a bootstrap over the *median* per-pair gain: no
 * distributional assumption, and the median shrugs off the one bad run that a
 * mean would let through. The cost is that a percentile bootstrap at n=10 is
 * mildly optimistic about its own coverage — real coverage is a bit under 95%.
 * That is acceptable because it is the conservative end being used as a gate;
 * being slightly generous about a lower bound still rejects every case the
 * table in section 6 says must be rejected.
 *
 * On determinism. This number ends up on a leaderboard and, scaled, inside an
 * on-chain record. A bootstrap draws random resamples, so an unseeded one would
 * give a slightly different answer every time it ran and nobody could reproduce
 * a verdict from the published samples. The seed is therefore derived from the
 * samples themselves: same pairs in, same verdict out, on any machine, forever.
 */

import { keccak256, toHex } from "viem";

/** One interleaved pair: the standing record and the candidate, back-to-back. */
export type PairedRun = {
  /** The standing record's metric on this pass. Higher is better. */
  baseline: number;
  /** The candidate's metric on this pass. Higher is better. */
  candidate: number;
};

export type AcceptanceConfig = {
  /** Section 5 `benchmark.min_gain_pct`. The bar the conservative gain must clear. */
  minGainPct: number;
  /** Section 5 `eval.quality_floor`, as a fraction. 0.60 means 60% of hidden tasks. */
  qualityFloor: number;
  /**
   * Fewer pairs than this and no verdict is issued. Below about five pairs a
   * bootstrap is resampling the same three numbers and its interval means
   * nothing, so the honest answer is "not measured yet", not "rejected".
   */
  minPairs?: number;
  /** Bootstrap resamples. 10k is stable to ~0.01pp on this data size. */
  resamples?: number;
  /** Two-sided confidence level; only the lower tail is used as the gate. */
  confidence?: number;
};

export const DEFAULT_ACCEPTANCE: Required<Pick<AcceptanceConfig, "minPairs" | "resamples" | "confidence">> = {
  minPairs: 5,
  resamples: 10_000,
  confidence: 0.95,
};

export type AcceptanceVerdict = {
  /** Whether the build should be promoted. The single answer the caller wants. */
  promoted: boolean;
  /**
   * Why, in a form the Submissions page can show verbatim. Section 12 page 7
   * wants the tuner to see the reason, not just a red cross.
   */
  reason:
    | "promoted"
    | "below-quality-floor"
    | "not-enough-pairs"
    | "median-below-threshold"
    | "gain-within-noise";
  /** Fraction of hidden tasks solved correctly, echoed back for the row. */
  passRate: number;
  /** Median per-pair gain, in percent. The headline number. */
  medianGainPct: number;
  /** Lower bound of the confidence interval, in percent. The number that gates. */
  conservativeGainPct: number;
  /** Upper bound, in percent. Shown so a wide interval is visibly wide. */
  optimisticGainPct: number;
  /**
   * Rig noise: the coefficient of variation of the baseline samples, in
   * percent. This is what separates the two "+1.4%" rows in section 6's table —
   * same median, different rig, different verdict.
   */
  noisePct: number;
  pairs: number;
};

/* -------------------------------------------------------------------------- */
/* Statistics                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Per-pair gain in percent.
 *
 * A ratio per pair, not a difference of two averages. Both runs in a pair saw
 * the same machine state, so their ratio has the shared drift divided out of
 * it; averaging first and dividing after would put the drift back in.
 */
export function pairedGainsPct(pairs: readonly PairedRun[]): number[] {
  return pairs.map(({ baseline, candidate }) => {
    if (!(baseline > 0) || !Number.isFinite(candidate)) {
      throw new Error(`invalid pair: baseline=${baseline} candidate=${candidate}`);
    }
    return (candidate / baseline - 1) * 100;
  });
}

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error("median of empty set");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Linear-interpolated percentile, the same convention NumPy uses by default. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) throw new Error("percentile of empty set");
  if (sorted.length === 1) return sorted[0];
  const rank = p * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (rank - lo) * (sorted[hi] - sorted[lo]);
}

/** Coefficient of variation in percent — the rig's own repeatability. */
export function coefficientOfVariationPct(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  // Sample variance (n-1): these runs are a sample of what the rig would do,
  // not the complete population of everything it will ever do.
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1);
  return (Math.sqrt(variance) / Math.abs(mean)) * 100;
}

/**
 * mulberry32: a small, fast, well-distributed 32-bit PRNG.
 *
 * Deliberately not `Math.random()`. The verdict has to be reproducible from the
 * published samples by anyone who wants to check our arithmetic, and a global
 * unseeded generator makes that impossible.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Derive the bootstrap seed from the data.
 *
 * Hashing the samples rather than carrying a seed field around means there is
 * no seed to lose, to disagree about, or to quietly retry until the interval
 * comes out favourable.
 */
export function seedFromSamples(gains: readonly number[]): number {
  // Fixed decimal places so 1.1 and 1.1000000000000001 cannot hash differently
  // on two machines that accumulated float error in a different order.
  const canonical = gains.map((g) => g.toFixed(9)).join(",");
  const digest = keccak256(toHex(canonical));
  return Number.parseInt(digest.slice(2, 10), 16) >>> 0;
}

/**
 * Percentile bootstrap over the median gain.
 *
 * @returns `[lower, upper]` bounds in percent at the requested confidence.
 */
export function bootstrapMedianCI(
  gains: readonly number[],
  confidence = DEFAULT_ACCEPTANCE.confidence,
  resamples = DEFAULT_ACCEPTANCE.resamples,
): [number, number] {
  const n = gains.length;
  if (n === 0) throw new Error("bootstrap of empty set");

  const random = mulberry32(seedFromSamples(gains));
  const medians = new Float64Array(resamples);
  const draw = new Float64Array(n);

  for (let i = 0; i < resamples; i += 1) {
    for (let j = 0; j < n; j += 1) {
      draw[j] = gains[(random() * n) | 0];
    }
    // Sorting n values per resample; n is ~10, so the naive sort is far cheaper
    // than any cleverness that would need an allocation.
    draw.sort();
    const mid = n >> 1;
    medians[i] = n % 2 === 1 ? draw[mid] : (draw[mid - 1] + draw[mid]) / 2;
  }

  const sorted = Array.from(medians).sort((a, b) => a - b);
  const tail = (1 - confidence) / 2;
  return [percentile(sorted, tail), percentile(sorted, 1 - tail)];
}

/* -------------------------------------------------------------------------- */
/* The rule                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Decide whether a candidate build should be promoted.
 *
 * The three rules are checked in the order section 6 states them, and the order
 * is load-bearing: a build that fails correctness is never described as "too
 * slow", because that would tell the tuner to optimise the wrong thing.
 *
 * @param passRate Fraction of hidden tasks the candidate solved correctly.
 */
export function decideAcceptance(
  pairs: readonly PairedRun[],
  passRate: number,
  config: AcceptanceConfig,
): AcceptanceVerdict {
  const { minPairs, resamples, confidence } = { ...DEFAULT_ACCEPTANCE, ...config };

  const base = {
    passRate,
    pairs: pairs.length,
    medianGainPct: 0,
    conservativeGainPct: 0,
    optimisticGainPct: 0,
    noisePct: pairs.length > 1 ? coefficientOfVariationPct(pairs.map((p) => p.baseline)) : 0,
  };

  // Rule 1. Correct enough. Checked first and alone: an incorrect build has no
  // meaningful speed, because "solved tasks per hour" counts solved tasks.
  if (passRate < config.qualityFloor) {
    return { ...base, promoted: false, reason: "below-quality-floor" };
  }

  if (pairs.length < minPairs) {
    return { ...base, promoted: false, reason: "not-enough-pairs" };
  }

  const gains = pairedGainsPct(pairs);
  const medianGainPct = median(gains);
  const [conservativeGainPct, optimisticGainPct] = bootstrapMedianCI(gains, confidence, resamples);

  const measured = { ...base, medianGainPct, conservativeGainPct, optimisticGainPct };

  // Rule 2. At least 1% better on the median.
  if (medianGainPct < config.minGainPct) {
    return { ...measured, promoted: false, reason: "median-below-threshold" };
  }

  // Rule 3. And still at least 1% better in the pessimistic case. This is the
  // rule that rejects the lucky run and the noisy rig.
  if (conservativeGainPct < config.minGainPct) {
    return { ...measured, promoted: false, reason: "gain-within-noise" };
  }

  return { ...measured, promoted: true, reason: "promoted" };
}

/**
 * The integer the registry stores.
 *
 * `VtecRegistry.Record.score` is a uint256 scaled by 1000, so a fractional
 * metric survives integer storage. Rounding, not truncation: truncating would
 * make a build that measured 41.2999 rank below one that measured 41.2998 after
 * a different rounding path elsewhere.
 */
export const SCORE_SCALE = 1000n;

export function toOnChainScore(metric: number): bigint {
  if (!Number.isFinite(metric) || metric < 0) {
    throw new Error(`metric must be a non-negative finite number, got ${metric}`);
  }
  return BigInt(Math.round(metric * Number(SCORE_SCALE)));
}

export function fromOnChainScore(score: bigint): number {
  return Number(score) / Number(SCORE_SCALE);
}

/** Human-readable reason, for the Submissions page and the runner's output. */
export function explainVerdict(verdict: AcceptanceVerdict, config: AcceptanceConfig): string {
  switch (verdict.reason) {
    case "promoted":
      return `Promoted: +${verdict.medianGainPct.toFixed(2)}% median, +${verdict.conservativeGainPct.toFixed(2)}% conservative (needs +${config.minGainPct}%).`;
    case "below-quality-floor":
      return `Not promoted: solved ${(verdict.passRate * 100).toFixed(1)}% of hidden tasks, floor is ${(config.qualityFloor * 100).toFixed(0)}%.`;
    case "not-enough-pairs":
      return `Not measured: ${verdict.pairs} paired runs, needs at least ${config.minPairs ?? DEFAULT_ACCEPTANCE.minPairs}.`;
    case "median-below-threshold":
      return `Not promoted: +${verdict.medianGainPct.toFixed(2)}% median gain is below the +${config.minGainPct}% bar.`;
    case "gain-within-noise":
      return `Not promoted: +${verdict.medianGainPct.toFixed(2)}% median, but only +${verdict.conservativeGainPct.toFixed(2)}% conservative — within this rig's noise (${verdict.noisePct.toFixed(2)}%).`;
  }
}
