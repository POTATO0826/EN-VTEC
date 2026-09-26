/**
 * The acceptance rule, checked against the table it came from.
 *
 *   bun run check:acceptance
 *
 * README section 6 states the rule as four worked examples:
 *
 *   | Result           | Median | Conservative | Outcome      |
 *   | Clearly better   | +6.8%  | +5.9%        | Promoted     |
 *   | Small, quiet rig | +1.4%  | +1.1%        | Promoted     |
 *   | Small, noisy rig | +1.4%  | +0.3%        | Not promoted |
 *   | Lucky run        | +2.0%  | -0.8%        | Rejected     |
 *
 * Rows two and three are the whole design: the same median gain, two different
 * rigs, two different answers. Any implementation that promotes both of them
 * has a leaderboard of lucky runs, so that pair is the case this file exists to
 * pin down. The synthetic rigs below reproduce the *shape* of each row rather
 * than its exact decimals — the decimals depend on the interval method, the
 * shape is what the rule promises.
 */

import {
  bootstrapMedianCI,
  coefficientOfVariationPct,
  decideAcceptance,
  explainVerdict,
  fromOnChainScore,
  median,
  pairedGainsPct,
  toOnChainScore,
  type AcceptanceConfig,
  type PairedRun,
} from "../packages/bench/src/acceptance";

/** Section 5's demo track config. */
const CONFIG: AcceptanceConfig = { minGainPct: 1.0, qualityFloor: 0.6 };

let failures = 0;

function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ok    ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}`);
    if (detail) console.log(`          ${detail}`);
  }
}

function near(label: string, got: number, want: number, tolerance: number) {
  check(label, Math.abs(got - want) <= tolerance, `got ${got.toFixed(4)}, want ${want} +/- ${tolerance}`);
}

/**
 * Build interleaved pairs from a baseline series and the per-pair gain each
 * candidate run achieved. Keeping the two explicit is what lets a "quiet" and a
 * "noisy" rig carry the identical median gain.
 */
function rig(baselines: readonly number[], gainsPct: readonly number[]): PairedRun[] {
  if (baselines.length !== gainsPct.length) throw new Error("rig: length mismatch");
  return baselines.map((baseline, i) => ({
    baseline,
    candidate: baseline * (1 + gainsPct[i] / 100),
  }));
}

/** A rig whose baseline barely moves: a quiet room, a fixed power limit. */
const QUIET_BASELINES = [38.7, 38.72, 38.68, 38.71, 38.69, 38.73, 38.7, 38.67, 38.72, 38.7];

/** A rig that drifts: thermals climbing, another process waking up. */
const NOISY_BASELINES = [38.7, 36.2, 41.1, 37.4, 40.8, 35.9, 39.6, 42.3, 36.8, 40.2];

console.log("acceptance rule (README section 6)");

/* -------------------------------------------------------------------------- */
/* Row 1 — clearly better                                                      */
/* -------------------------------------------------------------------------- */

{
  const gains = [5.9, 6.2, 6.4, 6.7, 6.75, 6.85, 7.0, 7.2, 7.4, 7.8];
  const verdict = decideAcceptance(rig(QUIET_BASELINES, gains), 0.85, CONFIG);

  near("row 1  median is +6.8%", verdict.medianGainPct, 6.8, 0.01);
  check("row 1  promoted", verdict.promoted, explainVerdict(verdict, CONFIG));
  check(
    "row 1  conservative gain clears the bar",
    verdict.conservativeGainPct >= CONFIG.minGainPct,
    `conservative ${verdict.conservativeGainPct.toFixed(2)}%`,
  );
}

/* -------------------------------------------------------------------------- */
/* Rows 2 and 3 — the same median, two rigs, two answers                       */
/* -------------------------------------------------------------------------- */

const SMALL_GAIN_QUIET = [1.25, 1.3, 1.32, 1.38, 1.39, 1.41, 1.44, 1.48, 1.5, 1.55];
const SMALL_GAIN_NOISY = [-8.0, -3.0, -1.0, 0.5, 1.2, 1.6, 3.0, 5.0, 9.0, 14.0];

const quiet = decideAcceptance(rig(QUIET_BASELINES, SMALL_GAIN_QUIET), 0.85, CONFIG);
const noisy = decideAcceptance(rig(NOISY_BASELINES, SMALL_GAIN_NOISY), 0.85, CONFIG);

{
  near("row 2  median is +1.4%", quiet.medianGainPct, 1.4, 0.01);
  check("row 2  promoted on a quiet rig", quiet.promoted, explainVerdict(quiet, CONFIG));
  check(
    "row 2  conservative gain clears the bar",
    quiet.conservativeGainPct >= CONFIG.minGainPct,
    `conservative ${quiet.conservativeGainPct.toFixed(2)}%`,
  );

  near("row 3  median is also +1.4%", noisy.medianGainPct, 1.4, 0.01);
  check("row 3  NOT promoted on a noisy rig", !noisy.promoted, explainVerdict(noisy, CONFIG));
  check(
    "row 3  rejected specifically as noise",
    noisy.reason === "gain-within-noise",
    `reason was ${noisy.reason}`,
  );

  // The claim the whole design rests on.
  near("rows 2 and 3 have the same median", quiet.medianGainPct, noisy.medianGainPct, 1e-9);
  check(
    "rows 2 and 3 disagree on the verdict",
    quiet.promoted && !noisy.promoted,
    "identical medians must not produce identical verdicts",
  );
  check(
    "the noisy rig is measurably noisier",
    noisy.noisePct > quiet.noisePct * 5,
    `quiet ${quiet.noisePct.toFixed(3)}% vs noisy ${noisy.noisePct.toFixed(3)}%`,
  );
}

/* -------------------------------------------------------------------------- */
/* Row 4 — the lucky run                                                       */
/* -------------------------------------------------------------------------- */

{
  const gains = [-12.0, -7.0, -4.0, -1.0, 1.8, 2.2, 4.0, 8.0, 15.0, 22.0];
  const verdict = decideAcceptance(rig(NOISY_BASELINES, gains), 0.85, CONFIG);

  near("row 4  median is +2.0%", verdict.medianGainPct, 2.0, 0.01);
  check("row 4  NOT promoted", !verdict.promoted, explainVerdict(verdict, CONFIG));
  check(
    "row 4  conservative gain is negative",
    verdict.conservativeGainPct < 0,
    `conservative ${verdict.conservativeGainPct.toFixed(2)}%`,
  );
}

/* -------------------------------------------------------------------------- */
/* Rule ordering and guards                                                    */
/* -------------------------------------------------------------------------- */

{
  // Rule 1 before rule 2: a build that fails correctness is never described as
  // slow, or the tuner optimises the wrong thing.
  const fast = rig(QUIET_BASELINES, [20, 21, 22, 23, 24, 25, 26, 27, 28, 29]);
  const verdict = decideAcceptance(fast, 0.41, CONFIG);
  check("quality floor is checked first", verdict.reason === "below-quality-floor", verdict.reason);
  check("a fast but incorrect build is not promoted", !verdict.promoted);

  const atFloor = decideAcceptance(fast, 0.6, CONFIG);
  check("passing exactly at the floor is enough", atFloor.promoted, explainVerdict(atFloor, CONFIG));
}

{
  const tooFew = rig(QUIET_BASELINES.slice(0, 3), [5, 5.1, 5.2]);
  const verdict = decideAcceptance(tooFew, 0.85, CONFIG);
  check("three pairs is not a measurement", verdict.reason === "not-enough-pairs", verdict.reason);
  check("and not a rejection either", !verdict.promoted);
}

{
  // A build that is worse gets the plain answer, not the noise answer.
  const slower = rig(QUIET_BASELINES, [-3, -2.8, -2.6, -2.5, -2.4, -2.3, -2.2, -2.0, -1.8, -1.5]);
  const verdict = decideAcceptance(slower, 0.85, CONFIG);
  check("a slower build fails on the median", verdict.reason === "median-below-threshold", verdict.reason);
}

{
  // Exactly the bar, measured cleanly, passes. The contract enforces the same
  // 1% floor on-chain, so the two halves must agree about the boundary.
  const exact = rig(QUIET_BASELINES, [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0]);
  const verdict = decideAcceptance(exact, 0.85, CONFIG);
  check("exactly +1% with zero spread is promoted", verdict.promoted, explainVerdict(verdict, CONFIG));
  near("zero spread means the interval collapses", verdict.conservativeGainPct, 1.0, 1e-9);
}

/* -------------------------------------------------------------------------- */
/* Determinism                                                                 */
/* -------------------------------------------------------------------------- */

{
  const pairs = rig(NOISY_BASELINES, SMALL_GAIN_NOISY);
  const a = decideAcceptance(pairs, 0.85, CONFIG);
  const b = decideAcceptance(pairs, 0.85, CONFIG);
  check(
    "the same samples give the same verdict, exactly",
    a.conservativeGainPct === b.conservativeGainPct && a.optimisticGainPct === b.optimisticGainPct,
    `${a.conservativeGainPct} vs ${b.conservativeGainPct}`,
  );

  // Anyone re-running the published samples must land on our number.
  const [lo] = bootstrapMedianCI(pairedGainsPct(pairs));
  check("and a bare bootstrap agrees with the verdict", lo === a.conservativeGainPct);

  const reordered = [...pairs].reverse();
  const c = decideAcceptance(reordered, 0.85, CONFIG);
  near("pair order does not change the median", c.medianGainPct, a.medianGainPct, 1e-9);
}

/* -------------------------------------------------------------------------- */
/* Primitives                                                                  */
/* -------------------------------------------------------------------------- */

{
  near("median of an odd set", median([3, 1, 2]), 2, 0);
  near("median of an even set", median([4, 1, 2, 3]), 2.5, 0);
  near("a flat series has no noise", coefficientOfVariationPct([5, 5, 5, 5]), 0, 1e-12);

  const gains = pairedGainsPct([{ baseline: 40, candidate: 42 }]);
  near("a 40 -> 42 pair is +5%", gains[0], 5, 1e-12);
}

/* -------------------------------------------------------------------------- */
/* The on-chain score                                                          */
/* -------------------------------------------------------------------------- */

{
  check("41.3 solved/hour scales to 41300", toOnChainScore(41.3) === 41_300n, String(toOnChainScore(41.3)));
  near("and scales back", fromOnChainScore(41_300n), 41.3, 1e-9);
  check("rounds rather than truncates", toOnChainScore(41.2999) === 41_300n, String(toOnChainScore(41.2999)));

  // VtecRegistry.promote reverts unless score * 100 >= best * 101. A build this
  // file promotes must not then be refused by the contract, so the boundary is
  // checked in the contract's own arithmetic.
  const best = toOnChainScore(38.7);
  const candidate = toOnChainScore(38.7 * 1.01);
  check(
    "a +1% build survives the contract's integer floor",
    candidate * 100n >= best * 101n,
    `${candidate} * 100 vs ${best} * 101`,
  );

  const barely = toOnChainScore(38.7 * 1.005);
  check(
    "a +0.5% build is refused by it",
    barely * 100n < best * 101n,
    `${barely} * 100 vs ${best} * 101`,
  );
}

console.log("");
if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("all acceptance checks passed");
