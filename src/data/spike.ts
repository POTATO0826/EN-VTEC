/**
 * The crossover spike's output, as a type.
 *
 * `crossover_test.py` (build plan section 11a) is the only thing that produces
 * this shape, and it is the first real measurement this project will have. The
 * types below mirror what that script writes, exactly, including the parts that
 * do not match the rest of this codebase:
 *
 *   - four variants, not five. There is no "E" in the spike.
 *   - variant keys are human labels with spaces: "A baseline", "B rolling",
 *     "C shared-K", "D 4-per-thread".
 *   - `_noise_band` is a FRACTION (0.032), while `Run.noiseBand` in this app is
 *     a percentage (3.2). Converting between them is the adapter's job, and
 *     getting it wrong by 100x is the obvious way to publish nonsense.
 *   - the noise band is per job size, while `Run.noiseBand` is one per run.
 *   - verdicts are "baseline" | "accepted" | "within noise", not the app's
 *     "accepted" | "rejected" | "failed" | "skipped".
 *
 * Deliberately NOT here: a function that turns a spike into a published `Run`.
 * A `Run` carries a plan hash, a commit transaction and a reveal transaction.
 * Those come from the evaluator (M2) and the chain (M6). Synthesising them from
 * a spike would be exactly the fabricated chain confirmation rule 1 forbids, so
 * the seam stops at the summary below and the rest is wired when it is real.
 */

/* -------------------------------------------------------------------------- */
/* The file on disk                                                            */
/* -------------------------------------------------------------------------- */

export type SpikeVerdict = "baseline" | "accepted" | "within noise";

export type SpikeMeasurement = {
  median_ms: number;
  speedup: number;
  verdict: SpikeVerdict;
};

/** One job size: a measurement per variant, plus the two derived fields. */
export type SpikeRow = Record<string, SpikeMeasurement | string | number> & {
  _winner: string;
  _noise_band: number;
};

export type SpikeFile = {
  gpu: string;
  vram_mb: number;
  sm_count: number;
  msg_len: number;
  runs: number;
  /** Keyed by job size as a decimal string, because JSON has no integer keys. */
  results: Record<string, SpikeRow>;
};

/** The four variants the spike compiles, in the order it reports them. */
export const SPIKE_VARIANTS = [
  "A baseline",
  "B rolling",
  "C shared-K",
  "D 4-per-thread",
] as const;

export type SpikeVariant = (typeof SPIKE_VARIANTS)[number];

/* -------------------------------------------------------------------------- */
/* Reading it safely                                                           */
/* -------------------------------------------------------------------------- */

export type SpikeProblem = { path: string; detail: string };

/**
 * Structural validation. Returns problems rather than throwing, so a bad file
 * can be reported in full instead of one error at a time.
 *
 * This checks shape, not plausibility. A file can be perfectly well formed and
 * still be unusable because the two sessions disagree - that is
 * `compareSessions` below, and it is the check section 11a actually gates on.
 */
export function validateSpike(value: unknown): SpikeProblem[] {
  const problems: SpikeProblem[] = [];
  const push = (path: string, detail: string) => problems.push({ path, detail });

  if (typeof value !== "object" || value === null) {
    return [{ path: "", detail: "not an object" }];
  }
  const file = value as Partial<SpikeFile>;

  for (const key of ["gpu"] as const) {
    if (typeof file[key] !== "string" || !file[key]) push(key, "missing or not a string");
  }
  for (const key of ["vram_mb", "sm_count", "msg_len", "runs"] as const) {
    if (typeof file[key] !== "number" || !Number.isFinite(file[key])) {
      push(key, "missing or not a number");
    }
  }
  if (typeof file.results !== "object" || file.results === null) {
    push("results", "missing");
    return problems;
  }

  const sizes = Object.keys(file.results);
  if (sizes.length === 0) push("results", "no job sizes");

  for (const size of sizes) {
    if (!/^\d+$/.test(size)) push(`results.${size}`, "job size key is not an integer");
    const row = file.results[size] as SpikeRow | undefined;
    if (typeof row !== "object" || row === null) {
      push(`results.${size}`, "not an object");
      continue;
    }
    if (typeof row._winner !== "string" || !row._winner) {
      push(`results.${size}._winner`, "missing");
    }
    if (typeof row._noise_band !== "number" || !Number.isFinite(row._noise_band)) {
      push(`results.${size}._noise_band`, "missing or not a number");
    } else if (row._noise_band < 0 || row._noise_band > 1) {
      // The script writes sd/median doubled, which is a fraction. A value above
      // 1 almost certainly means someone converted to a percentage on the way in.
      push(
        `results.${size}._noise_band`,
        `${row._noise_band} is outside 0..1 - the spike writes a fraction, not a percentage`,
      );
    }

    const measured = variantsIn(row);
    if (!measured.includes("A baseline")) {
      // Everything is a ratio against the baseline. Without it there is nothing.
      push(`results.${size}`, "no 'A baseline' measurement");
    }
    for (const name of measured) {
      const m = row[name] as SpikeMeasurement;
      if (typeof m.median_ms !== "number" || m.median_ms <= 0) {
        push(`results.${size}.${name}.median_ms`, "missing or not positive");
      }
      if (typeof m.speedup !== "number" || !Number.isFinite(m.speedup)) {
        push(`results.${size}.${name}.speedup`, "missing or not a number");
      }
      if (!["baseline", "accepted", "within noise"].includes(m.verdict)) {
        push(`results.${size}.${name}.verdict`, `unexpected verdict ${String(m.verdict)}`);
      }
    }
    if (row._winner && !measured.includes(row._winner)) {
      push(`results.${size}._winner`, `${row._winner} has no measurement in this row`);
    }
  }

  return problems;
}

/** The measured variant names in a row, skipping the underscore-prefixed fields. */
export function variantsIn(row: SpikeRow): string[] {
  return Object.keys(row).filter((key) => !key.startsWith("_"));
}

/** Job sizes in ascending numeric order. JSON key order is not to be trusted. */
export function jobSizes(file: SpikeFile): number[] {
  return Object.keys(file.results)
    .map(Number)
    .sort((a, b) => a - b);
}

/* -------------------------------------------------------------------------- */
/* What the spike actually tells us                                            */
/* -------------------------------------------------------------------------- */

export type SpikeSummary = {
  gpu: string;
  /** Winner per job size, ascending. */
  winners: { jobSize: number; winner: string; noiseBandPct: number; speedup: number }[];
  /** True when the winner is not the same at every size - section 11a's question. */
  hasCrossover: boolean;
  /** Distinct winners, in the order first seen. */
  distinctWinners: string[];
};

export function summariseSpike(file: SpikeFile): SpikeSummary {
  const winners = jobSizes(file).map((jobSize) => {
    const row = file.results[String(jobSize)];
    const winner = row._winner;
    const measurement = row[winner] as SpikeMeasurement | undefined;
    return {
      jobSize,
      winner,
      // Fraction to percentage, once, here. See the note at the top of the file.
      noiseBandPct: row._noise_band * 100,
      speedup: measurement?.speedup ?? 1,
    };
  });

  const distinct: string[] = [];
  for (const { winner } of winners) if (!distinct.includes(winner)) distinct.push(winner);

  return {
    gpu: file.gpu,
    winners,
    hasCrossover: distinct.length > 1,
    distinctWinners: distinct,
  };
}

/* -------------------------------------------------------------------------- */
/* The gate                                                                    */
/* -------------------------------------------------------------------------- */

export type SessionComparison = {
  agree: boolean;
  rows: { jobSize: number; first: string; second: string; same: boolean }[];
  /** Sizes present in one file and not the other. */
  onlyInOne: number[];
};

/**
 * Section 11a: "Run twice, a few minutes apart. If winners change between runs,
 * noise is larger than the differences and results aren't usable yet."
 *
 * This is the gate. It is a function rather than a note in a README because the
 * alternative is comparing two JSON files by eye at 2am before a demo.
 */
export function compareSessions(first: SpikeFile, second: SpikeFile): SessionComparison {
  const a = new Set(jobSizes(first));
  const b = new Set(jobSizes(second));
  const shared = [...a].filter((size) => b.has(size)).sort((x, y) => x - y);
  const onlyInOne = [...new Set([...a, ...b])]
    .filter((size) => !(a.has(size) && b.has(size)))
    .sort((x, y) => x - y);

  const rows = shared.map((jobSize) => {
    const firstWinner = first.results[String(jobSize)]._winner;
    const secondWinner = second.results[String(jobSize)]._winner;
    return {
      jobSize,
      first: firstWinner,
      second: secondWinner,
      same: firstWinner === secondWinner,
    };
  });

  return {
    agree: rows.length > 0 && rows.every((row) => row.same) && onlyInOne.length === 0,
    rows,
    onlyInOne,
  };
}
