/**
 * Verification results as /results shows them: one entry per submitted
 * kernel, with what verifiers measured and the evidence chain behind it.
 * Pure, so the server builds entries and the browser scores them with the
 * same code.
 */

export type SpokeSetId = "harness" | "model";
export type Metrics = Partial<Record<string, number>>;
export type Cat = { label: string; color: string };

export type Spoke = {
  key: string;
  label: string;
  name: string;
  unit: string;
  cat: string;
  /** Smaller is better (times, energy, error). */
  lower: boolean;
  dp: number;
  /**
   * "baseline": 0 = the baseline kernel's value, 100 = the leaderboard's best.
   * "tolerance": 0 = at the track's tolerance, 100 = identical to the baseline output.
   */
  scale: "baseline" | "tolerance";
};

export type SpokeSet = { spokes: Spoke[]; cats: Record<string, Cat> };

// Hexagons, clockwise from the top. Spokes of one category sit next to each other.
export const SPOKE_SETS: Record<SpokeSetId, SpokeSet> = {
  // What a verifier's harness measures itself when it re-runs a kernel.
  harness: {
    cats: {
      speed: { label: "SPEED", color: "#f2b84b" },
      tail: { label: "TAIL", color: "#a98bf5" },
      stability: { label: "STABILITY", color: "#63d3e8" },
      accuracy: { label: "ACCURACY", color: "#6fcf97" },
    },
    spokes: [
      { key: "speed", label: "SPEED", name: "Median run", unit: "s", cat: "speed", lower: true, dp: 2, scale: "baseline" },
      { key: "best", label: "BEST", name: "Fastest run", unit: "s", cat: "speed", lower: true, dp: 2, scale: "baseline" },
      { key: "worst", label: "WORST", name: "Slowest run", unit: "s", cat: "tail", lower: true, dp: 2, scale: "baseline" },
      { key: "cold", label: "COLD START", name: "Warm-up run", unit: "s", cat: "tail", lower: true, dp: 2, scale: "baseline" },
      { key: "noise", label: "NOISE", name: "Run-to-run spread", unit: "%", cat: "stability", lower: true, dp: 1, scale: "baseline" },
      { key: "precision", label: "PRECISION", name: "Max deviation", unit: "", cat: "accuracy", lower: true, dp: 1, scale: "tolerance" },
    ],
  },
  // How a local model performs on a workload with a kernel in place.
  model: {
    cats: {
      tps: { label: "TPS", color: "#63d3e8" },
      tpm: { label: "TPM", color: "#a98bf5" },
      energy: { label: "ENERGY", color: "#6fcf97" },
      speed: { label: "SPEED", color: "#f2b84b" },
    },
    spokes: [
      { key: "tpm", label: "TPM", name: "Sustained TPM", unit: "tok/min", cat: "tpm", lower: false, dp: 0, scale: "baseline" },
      { key: "energy", label: "ENERGY", name: "Energy", unit: "J/tok", cat: "energy", lower: true, dp: 3, scale: "baseline" },
      { key: "speed", label: "SPEED", name: "Kernel time", unit: "µs", cat: "speed", lower: true, dp: 1, scale: "baseline" },
      { key: "p99", label: "P99", name: "p99 latency", unit: "ms", cat: "speed", lower: true, dp: 1, scale: "baseline" },
      { key: "prefill", label: "PREFILL", name: "Prefill TPS", unit: "tok/s", cat: "tps", lower: false, dp: 0, scale: "baseline" },
      { key: "tps", label: "TPS", name: "Decode TPS", unit: "tok/s", cat: "tps", lower: false, dp: 1, scale: "baseline" },
    ],
  },
};

/** The harness set, for code that builds harness entries. */
export const SPOKES = SPOKE_SETS.harness.spokes;

export type Status = "pending" | "verifying" | "verified" | "rejected";

export type VerifierRun = {
  who: string;
  hardware: string;
  /** False while the verifier is still running it. */
  reported: boolean;
  /** Set when the verifier's machine couldn't run the build, with why. */
  incompatible?: string;
  report?: {
    speedup: number;
    baselineS: number;
    candidateS: number;
    pass: boolean;
    /** Plain-language verdict, one sentence. */
    reason: string;
    runs: number;
    /** Same output as the baseline on every seed. */
    identical: boolean;
  };
};

export type Evidence = {
  status: Status;
  submittedAt: string;
  buildSha256: string;
  gpu: string;
  runtimeS: number;
  approval: { worldId: boolean; fee: { digest: string; amountSui: number } | null } | null;
  /** Where the verifier pool was drawn from: a Sui tx digest, or "server". */
  draw: { source: string } | null;
  quorum: number;
  harness: boolean;
  harnessRunning: boolean;
  verifiers: VerifierRun[];
  outcome: { speedup: number | null; at: string } | null;
  feeSettlement: { digest: string; recipients: number; amountSui: number | null } | null;
};

export type ResultEntry = {
  id: string;
  /** Which hexagon this entry is scored on. */
  set: SpokeSetId;
  /** Short name for the orb. */
  label: string;
  workload: string;
  track: string;
  /** What the leaderboard ranks, e.g. the track or model. */
  model: string;
  hardware: string;
  kernel: { name: string; rank: number | null; of: number };
  /** The baseline kernel's value per spoke. A spoke without one isn't measured. */
  baseline: Metrics;
  /** Rank #1 on this leaderboard. */
  top1: Metrics;
  /** One per verifier whose output matched the baseline. */
  runs: { who: string; metrics: Metrics }[];
  /** The track's output tolerance: the 0 ring of a "tolerance" spoke. */
  tolerance?: number;
  detail: Evidence;
};

/* -------------------------------------------------------------------------- */
/* Stats                                                                       */
/* -------------------------------------------------------------------------- */

export const pctVsBaseline = (v: number, base: number, lower: boolean) => (lower ? base / v - 1 : v / base - 1) * 100;

/** 0 = baseline, 100 = leaderboard best; lower-is-better inverted first; floor −25. */
export function normalize(v: number, base: number, best: number, lower: boolean) {
  const imp = (x: number) => (lower ? base / x : x / base);
  const top = imp(best);
  const s = top <= 1 ? 0 : ((imp(v) - 1) / (top - 1)) * 100;
  return clamp(s);
}

const clamp = (s: number) => Math.max(-25, Math.min(100, Number.isFinite(s) ? s : 0));

export type Range = { min: number; max: number; median: number };

export function range(vals: number[]): Range | null {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b);
  const m = s.length >> 1;
  return { min: s[0], max: s[s.length - 1], median: s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 };
}

export const highVariance = (r: Range | null) => !!r && !!r.median && (r.max - r.min) / r.median > 0.1;
export const grade = (score: number) => (score >= 95 ? "S" : score >= 80 ? "A" : score >= 50 ? "B" : "C");
export const fmt = (v: number | null | undefined, dp: number) =>
  v == null ? "—" : v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const pct = (v: number | null) => (v == null ? "—" : (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(1) + "%");
export const times = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(2)}×`);
/** Small numbers such as tensor errors: 2.4e-4, or 0 for an exact match. */
export const sci = (v: number | null | undefined) => (v == null ? "—" : v === 0 ? "0" : v.toExponential(1));

/** A spoke's value with its unit, e.g. "2.16 s", "±1.8%", "2.4e-4". */
export function valueText(s: Spoke, v: number | null | undefined) {
  if (v == null) return "—";
  if (s.scale === "tolerance") return sci(v);
  if (s.unit === "%") return `±${fmt(v, s.dp)}%`;
  if (s.unit === "") return fmt(v, s.dp);
  return `${fmt(v, s.dp)} ${s.unit}`;
}

export type SpokeStat = Spoke & {
  measured: boolean;
  r: Range | null;
  baseline: number;
  /** Scores on the 0 – 100 scale. */
  med: number;
  lo: number;
  hi: number;
  ghost: number;
  /** Median vs the baseline as a percentage; null on the tolerance scale. */
  pctMed: number | null;
  hv: boolean;
  /** Presentation, so components don't special-case the scales. */
  medianText: string;
  deltaText: string;
  rangeText: string;
  baselineText: string;
};

/** Per-spoke shape for one entry: scores for the chart plus the real values. */
export function spokeStats(entry: ResultEntry): SpokeStat[] {
  return SPOKE_SETS[entry.set].spokes.map((s) => {
    const base = s.scale === "tolerance" ? entry.tolerance : entry.baseline[s.key];
    const vals = entry.runs.map((run) => run.metrics[s.key]).filter((v): v is number => v != null);
    const r = range(vals);
    if (base == null || (s.scale === "baseline" && base <= 0)) {
      return {
        ...s, measured: false, r: null, baseline: 0, med: 0, lo: 0, hi: 0, ghost: 0, pctMed: null, hv: false,
        medianText: "—", deltaText: "not measured yet", rangeText: "not measured yet", baselineText: "—",
      };
    }
    let score: (v: number) => number;
    if (s.scale === "tolerance") {
      // Linear in the error: at the tolerance = 0, bit-exact = 100.
      score = (v) => clamp((1 - v / base) * 100);
    } else {
      const imp = (v: number) => (s.lower ? base / v : v / base);
      const best = Math.max(imp(entry.top1[s.key] ?? base), ...vals.map(imp));
      const bestVal = s.lower ? base / best : base * best;
      score = (v) => normalize(v, base, bestVal, s.lower);
    }
    const ghostVal = entry.top1[s.key];
    const pctMed = r && s.scale === "baseline" ? pctVsBaseline(r.median, base, s.lower) : null;
    return {
      ...s,
      measured: true,
      r,
      baseline: base,
      med: r ? score(r.median) : 0,
      // The better end of the range scores highest, whichever way the spoke runs.
      lo: r ? Math.min(score(r.min), score(r.max)) : 0,
      hi: r ? Math.max(score(r.min), score(r.max)) : 0,
      ghost: ghostVal != null ? score(ghostVal) : 0,
      pctMed,
      hv: s.scale === "baseline" && highVariance(r),
      medianText: valueText(s, r?.median),
      deltaText: !r
        ? "awaiting runs"
        : s.scale === "tolerance"
          ? r.median <= base
            ? `within tolerance ${sci(base)}`
            : `outside tolerance ${sci(base)}`
          : `${pct(pctMed)} vs baseline`,
      rangeText: !r ? "awaiting runs" : `${valueText(s, r.min)} to ${valueText(s, r.max)}`,
      baselineText: s.scale === "tolerance" ? `tolerance ${sci(base)}` : `baseline ${valueText(s, base)}`,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Evidence timeline                                                           */
/* -------------------------------------------------------------------------- */

export type StepState = "done" | "current" | "todo" | "failed" | "skipped";

export type Step = {
  id: string;
  state: StepState;
  title: string;
  summary: string;
  time?: string;
  detail?: string[];
  link?: { label: string; href: string } | null;
  reports?: VerifierRun[];
  settlement?: { text: string; href: string };
};

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Everything that happened to a submission, in order. `tx` links a Sui digest. */
export function buildSteps(d: Evidence, tx: (digest: string) => string): Step[] {
  const ran = d.verifiers.filter((v) => v.reported).length;
  const total = d.verifiers.length;
  const steps: Step[] = [];

  steps.push({
    id: "submitted",
    state: "done",
    title: "Submitted by the agent",
    time: hhmm(d.submittedAt),
    summary: `${d.buildSha256.slice(0, 16)}… · ${d.gpu} · ${d.runtimeS.toFixed(1)} s there`,
    detail: ["Exact code hashed and uploaded by the CLI agent.", `Build SHA-256 ${d.buildSha256}`],
  });

  steps.push(
    d.approval?.worldId
      ? { id: "worldid", state: "done", title: "World ID approval", summary: "A verified human approved this one submission." }
      : { id: "worldid", state: "skipped", title: "World ID approval", summary: "Skipped: made before approvals existed." },
  );

  steps.push(
    d.approval?.fee
      ? {
          id: "fee",
          state: "done",
          title: `Process fee · ${d.approval.fee.amountSui} SUI`,
          summary: "Paid and held in the VTEC vault on Sui.",
          link: { label: "Sui tx", href: tx(d.approval.fee.digest) },
        }
      : { id: "fee", state: "skipped", title: "Process fee", summary: "Skipped: no fee on this submission." },
  );

  if (!d.draw) {
    steps.push({
      id: "draw",
      state: "current",
      title: "Verifiers drawn",
      summary: "Waiting for enough verifiers with matching hardware to join the pool.",
    });
  } else {
    const onChain = d.draw.source !== "server";
    const detail = [onChain ? "Picked with Sui on-chain randomness." : "Picked with server randomness."];
    if (d.harness) {
      detail.push(`Too few people in the pool, so the platform harness stood in. ${d.quorum} of ${total} must agree.`);
    }
    steps.push({
      id: "draw",
      state: "done",
      title: d.harness ? "Verifiers drawn · platform harness" : `Verifiers drawn · ${total}`,
      summary: d.verifiers.map((v) => v.who).join(", "),
      detail,
      link: onChain ? { label: "Sui tx", href: tx(d.draw.source) } : null,
    });
  }

  steps.push({
    id: "rerun",
    state: !d.draw ? "todo" : ran < total ? "current" : "done",
    title: `Re-run on verifiers' hardware${d.draw ? ` · ${ran}/${total}` : ""}`,
    summary: !d.draw
      ? "Starts once verifiers are drawn."
      : ran < total
        ? d.harnessRunning
          ? "Running baseline vs this build now…"
          : `${total - ran} still running…`
        : "All verifiers reported.",
    reports: d.verifiers,
  });

  const outcome: Step =
    d.status === "verified"
      ? {
          id: "outcome",
          state: "done",
          title: `Verified at ${times(d.outcome?.speedup)}, now on the ranking`,
          summary: "Listed on the Kernel Code Efficiency Ranking.",
          link: { label: "View ranking", href: "/models" },
          time: d.outcome ? hhmm(d.outcome.at) : undefined,
        }
      : d.status === "rejected"
        ? {
            id: "outcome",
            state: "failed",
            title: "Not proven faster",
            summary:
              d.outcome?.speedup != null
                ? `Verifiers measured ${times(d.outcome.speedup)}, not a proven gain over the baseline. Not ranked.`
                : "Verifiers didn't get the baseline's output, so it isn't correct. Not ranked.",
            time: d.outcome ? hhmm(d.outcome.at) : undefined,
          }
        : { id: "outcome", state: "todo", title: "Outcome", summary: `Decided once ${d.quorum} verifiers agree.` };
  if (d.feeSettlement) {
    const amount = d.feeSettlement.amountSui != null ? ` (${d.feeSettlement.amountSui} SUI)` : "";
    outcome.settlement = {
      text:
        d.feeSettlement.recipients === 1
          ? `Fee${amount} paid out to the verifier.`
          : `Fee${amount} split between ${d.feeSettlement.recipients} verifiers.`,
      href: tx(d.feeSettlement.digest),
    };
  }
  steps.push(outcome);
  return steps;
}
