import "server-only";
import { MIN_GAIN_PCT } from "@/lib/rules";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { findTrack } from "@/lib/catalog";
import { range, SPOKES, type Metrics, type ResultEntry, type VerifierRun } from "@/lib/results";
import { harnessRunning, PLATFORM_SESSION } from "./harness";
import type { load, Submission, VerifyReport } from "./store";
import { QUORUM } from "./verification";

type Data = Awaited<ReturnType<typeof load>>;

/** How many of a session's submissions /results shows, newest first. */
const RECENT = 10;

/** Plain-language reason a report passed or failed. */
export function reportReason(r: VerifyReport) {
  if (!r.compatible) return `Couldn't run it here: ${r.reason}.`;
  if (!r.hashMatches) return "The downloaded code didn't match the submitted hash.";
  if (!r.correct) return "Different output from the baseline on the same inputs, so it isn't correct.";
  const gain = (r.speedup - 1) * 100;
  if (r.pass) return `${r.speedup.toFixed(2)}× faster: every run beat the baseline, well beyond the noise (±${r.noisePct}%).`;
  if (gain < MIN_GAIN_PCT) return `${r.speedup.toFixed(2)}× means no real speedup over the baseline (needs at least ${MIN_GAIN_PCT}%).`;
  if (gain <= 2 * r.noisePct) return `${r.speedup.toFixed(2)}× is too close to this machine's noise (±${r.noisePct}%) to be proven.`;
  return `${r.speedup.toFixed(2)}× on average, but some runs were no faster than the baseline, so it isn't proven.`;
}

/** The track's output tolerance from tracks/<id>/track.json. */
function toleranceOf(trackId: string) {
  const file = path.join(process.cwd(), "tracks", trackId, "track.json");
  if (!existsSync(file)) return 1e-3;
  try {
    const cfg = JSON.parse(readFileSync(file, "utf8")) as { tolerance?: number };
    return cfg.tolerance ?? 1e-3;
  } catch {
    return 1e-3;
  }
}

/**
 * One verifier's report as per-spoke pairs (candidate, baseline), in seconds
 * for times and percent for spread. Reports from older agents only carry the
 * medians, so the other spokes stay undefined and show as not measured.
 */
function spokePairs(r: VerifyReport): Partial<Record<string, [cand: number, base: number]>> {
  const spread = (ms: number[] | undefined) => {
    const g = range(ms ?? []);
    return g && g.median > 0 ? ((g.max - g.min) / g.median) * 100 : null;
  };
  const out: Partial<Record<string, [number, number]>> = {
    speed: [r.candidateMedianMs / 1000, r.baselineMedianMs / 1000],
  };
  const c = range(r.candidateMs ?? []);
  const b = range(r.baselineMs ?? []);
  if (c && b) {
    out.best = [c.min / 1000, b.min / 1000];
    out.worst = [c.max / 1000, b.max / 1000];
  }
  const cn = spread(r.candidateMs);
  // Older reports still say how noisy the baseline was; the floor keeps a
  // perfectly steady baseline from making any spread look infinitely worse.
  const bn = spread(r.baselineMs) ?? (r.baselineMs ? null : r.noisePct);
  if (cn != null && bn != null) out.noise = [cn, Math.max(bn, 0.1)];
  if (r.warmupCandidateMs != null && r.warmupBaselineMs != null) {
    out.cold = [r.warmupCandidateMs / 1000, r.warmupBaselineMs / 1000];
  }
  if (r.maxError != null) out.precision = [r.maxError, 0];
  return out;
}

/** Reports that reproduced the baseline's output: the only ones that say anything about speed. */
const validReports = (data: Data, submissionId: string) =>
  data.assignments
    .filter((a) => a.submissionId === submissionId && a.report?.compatible && a.report.hashMatches && a.report.correct)
    .map((a) => a.report!);

/**
 * A submission's runs, one per valid verifier. Every verifier times the
 * baseline on their own machine, so each candidate time is scaled by the
 * consensus baseline over that verifier's baseline: what the run would have
 * taken on the typical verifier's hardware.
 */
function runsOf(reports: { who: string; report: VerifyReport }[]) {
  const pairs = reports.map((x) => ({ who: x.who, p: spokePairs(x.report) }));
  const baseline: Metrics = {};
  for (const s of SPOKES) {
    if (s.scale === "tolerance") continue;
    const bases = pairs.map((x) => x.p[s.key]?.[1]).filter((v): v is number => v != null);
    const g = range(bases);
    if (g) baseline[s.key] = g.median;
  }
  const runs = pairs.map(({ who, p }) => {
    const metrics: Metrics = {};
    for (const s of SPOKES) {
      const pair = p[s.key];
      if (!pair) continue;
      const [cand, base] = pair;
      const consensus = baseline[s.key];
      metrics[s.key] = s.scale === "tolerance" || consensus == null || base <= 0 ? cand : cand * (consensus / base);
    }
    return { who, metrics };
  });
  return { baseline, runs };
}

/**
 * A session's recent submissions as result entries, plus `include` if it
 * isn't one of them (someone opened another tuner's kernel page).
 */
export function resultEntries(data: Data, sessionId: string | null, include: string | null): ResultEntry[] {
  const mine = data.submissions
    .filter((s) => sessionId && s.sessionId === sessionId)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, RECENT);
  const extra = include && !mine.some((s) => s.id === include) ? data.submissions.filter((s) => s.id === include) : [];
  const subs = [...extra, ...mine];

  // Orb labels are the build's short name; repeats get numbered, oldest first.
  const short = (s: Submission) => s.buildName.split(" (")[0];
  const counts = new Map<string, number>();
  for (const s of subs) counts.set(short(s), (counts.get(short(s)) ?? 0) + 1);
  const seen = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const s of [...subs].sort((a, b) => a.at.localeCompare(b.at))) {
    const name = short(s);
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    labels.set(s.id, counts.get(name)! > 1 ? `${name} #${n}` : name);
  }

  return subs.map((s) => entryOf(data, s, labels.get(s.id)!, sessionId));
}

function entryOf(data: Data, sub: Submission, label: string, sessionId: string | null): ResultEntry {
  const track = findTrack(sub.trackId);
  const approval = data.approvals.find((a) => a.id === sub.approvalId) ?? null;
  const feeSui = approval?.fee ? Number(approval.fee.amountMist) / 1e9 : null;

  let n = 0;
  const reports = data.assignments
    .filter((a) => a.submissionId === sub.id)
    .map((a) => ({
      who: a.sessionId === PLATFORM_SESSION ? "Platform harness" : a.sessionId === sessionId ? "You" : `Verifier ${++n}`,
      agent: data.agents.find((g) => g.sessionId === a.sessionId),
      report: a.report,
    }));

  const verifiers: VerifierRun[] = reports.map(({ who, agent, report: r }) => {
    if (!r) {
      const hardware = agent ? [agent.gpus[0]?.name, agent.cpu].filter(Boolean).join(" + ") : "";
      return { who, hardware, reported: false };
    }
    if (!r.compatible) return { who, hardware: r.hardware, reported: true, incompatible: r.reason ?? "not compatible" };
    return {
      who,
      hardware: r.hardware,
      reported: true,
      report: {
        speedup: r.speedup,
        baselineS: r.baselineMedianMs / 1000,
        candidateS: r.candidateMedianMs / 1000,
        pass: r.pass,
        reason: reportReason(r),
        runs: r.runs,
        identical: r.correct,
      },
    };
  });

  const valid = reports.filter((x) => x.report?.compatible && x.report.hashMatches && x.report.correct) as {
    who: string;
    report: VerifyReport;
  }[];
  const { baseline, runs } = runsOf(valid);

  // The ranking for this track: verified kernels, fastest first. The best
  // verified value per spoke is the chart's 100 ring.
  const board = data.submissions
    .filter((s) => s.trackId === sub.trackId && s.status === "verified" && s.speedup != null)
    .sort((a, b) => b.speedup! - a.speedup!);
  const rank = board.findIndex((s) => s.id === sub.id);
  const top1: Metrics = {};
  for (const other of board) {
    const theirs = runsOf(validReports(data, other.id).map((report) => ({ who: "", report })));
    for (const s of SPOKES) {
      const vals = theirs.runs.map((r) => r.metrics[s.key]).filter((v): v is number => v != null);
      const g = range(vals);
      if (!g) continue;
      // Times are machine-relative: carry the ratio to this entry's baseline.
      const v =
        s.scale === "tolerance" || theirs.baseline[s.key] == null || baseline[s.key] == null
          ? g.median
          : (g.median / theirs.baseline[s.key]!) * baseline[s.key]!;
      top1[s.key] = Math.min(top1[s.key] ?? Infinity, v);
    }
  }

  const decided = sub.status === "verified" || sub.status === "rejected";
  return {
    id: sub.id,
    set: "harness",
    label,
    workload: track?.name ?? sub.trackId,
    track: sub.trackId,
    model: track?.name ?? sub.trackId,
    hardware: sub.gpu,
    kernel: { name: sub.buildName, rank: rank >= 0 ? rank + 1 : null, of: board.length },
    baseline,
    top1,
    runs,
    tolerance: valid[0]?.report.tolerance ?? toleranceOf(sub.trackId),
    detail: {
      // Awaiting its stake is still "not verified yet" to anyone reading results.
      status: sub.status === "awaiting_stake" ? "pending" : sub.status,
      submittedAt: sub.at,
      buildSha256: sub.buildSha256,
      gpu: sub.gpu,
      runtimeS: sub.seconds,
      approval: approval
        ? {
            worldId: approval.kind === "worldid" && !!approval.nullifier,
            fee: approval.fee ? { digest: approval.fee.digest, amountSui: feeSui! } : null,
          }
        : null,
      stake: sub.stake
        ? {
            amountSui: Number(sub.stake.amountMist) / 1e9,
            digest: sub.stake.digest,
            settled: sub.stake.settled
              ? {
                  outcome: sub.stake.settled.outcome,
                  digest: sub.stake.settled.digest,
                  leader: sub.stake.settled.leader,
                  verifiersPaid: sub.stake.settled.verifiersPaid,
                }
              : null,
          }
        : null,
      draw: sub.draw ? { source: sub.draw.source } : null,
      quorum: sub.quorum ?? QUORUM,
      harness: !!sub.harness,
      harnessRunning: harnessRunning(),
      verifiers,
      outcome: decided
        ? {
            speedup:
              sub.status === "verified" ? sub.speedup : (range(valid.map((x) => x.report.speedup))?.median ?? null),
            at: sub.settledAt ?? sub.at,
          }
        : null,
      feeSettlement: sub.feeSettlement
        ? { digest: sub.feeSettlement.digest, recipients: sub.feeSettlement.recipients.length, amountSui: feeSui }
        : null,
    },
  };
}
