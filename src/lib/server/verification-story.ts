import "server-only";
import { MIN_GAIN_PCT } from "@/lib/rules";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { findTrack } from "@/lib/catalog";
import { PLATFORM_SESSION, harnessRunning } from "./harness";
import type { load, Submission, VerifyReport } from "./store";
import { QUORUM } from "./verification";
import { DATA_DIR, dataPath } from "@/lib/server/data-dir";

type Data = Awaited<ReturnType<typeof load>>;

/** One rule of "clearly faster", checked against a verifier's own numbers. */
export type Check = { label: string; ok: boolean; detail: string };

export type VerifierStory = {
  who: string;
  hardware: string;
  platform: boolean;
  /** Where the terminal lines come from. */
  source: "harness log" | "report" | "running";
  lines: string[];
  checks: Check[];
  /** Every timed run in seconds, when the report or the log has them. */
  runs: { base: number[]; cand: number[] } | null;
  noisePct: number | null;
  speedup: number | null;
  pass: boolean | null;
};

export type VerificationStory = {
  id: string;
  track: string;
  trackId: string;
  buildName: string;
  buildSha256: string;
  resultSha256: string;
  gpu: string;
  seconds: number;
  status: Submission["status"];
  speedup: number | null;
  submittedAt: string;
  settledAt: string | null;
  tuneLog: string[] | null;
  approval: { worldId: boolean; fee: { digest: string; amountSui: number } | null } | null;
  draw: { source: string } | null;
  harness: boolean;
  harnessRunning: boolean;
  quorum: number;
  verifiers: VerifierStory[];
  feeSettlement: { digest: string; recipients: number } | null;
  listing: { id: string; digest: string } | null;
  tolerance: number;
};

const LOG = dataPath("harness.log");

/** The platform harness's printed lines for a submission: its latest block in the log. */
function harnessLines(submissionId: string): string[] | null {
  if (!existsSync(LOG)) return null;
  const lines = readFileSync(LOG, "utf8").split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) if (lines[i].startsWith(`▶ ${submissionId} `)) start = i;
  if (start < 0) return null;
  const out = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("▶ ") || lines[i].startsWith("=== ")) break;
    if (lines[i].trim()) out.push(lines[i]);
  }
  return out;
}

const RUN = /run\s+\d+\/\d+\s+(?:seed\s+\d+\s+)?baseline\s+([\d.]+)\s*s\s+candidate\s+([\d.]+)\s*s/;

/** Per-run times in seconds: from the report when it has them, else from the printed lines. */
function runsOf(r: VerifyReport, lines: string[]) {
  if (r.baselineMs?.length && r.candidateMs?.length) {
    return { base: r.baselineMs.map((v) => v / 1000), cand: r.candidateMs.map((v) => v / 1000) };
  }
  const base: number[] = [];
  const cand: number[] = [];
  for (const l of lines) {
    const m = l.match(RUN);
    if (m) {
      base.push(Number(m[1]));
      cand.push(Number(m[2]));
    }
  }
  return base.length ? { base, cand } : null;
}

/** The lines the agent prints for a verification, rebuilt from its report. */
function linesFromReport(sub: Submission, r: VerifyReport): string[] {
  const out = [`▶ ${sub.id} · ${sub.trackId} · ${sub.buildName}`];
  if (!r.compatible) return [...out, `  ⚠ not compatible: ${r.reason}`];
  out.push(`  code hash ${r.hashMatches ? "matches" : "DOES NOT match"} the submission`, "  warm-up…");
  const n = Math.min(r.baselineMs?.length ?? 0, r.candidateMs?.length ?? 0);
  for (let i = 0; i < n; i++) {
    out.push(
      `  run ${i + 1}/${n}  baseline ${(r.baselineMs![i] / 1000).toFixed(2)} s   candidate ${(r.candidateMs![i] / 1000).toFixed(2)} s   ${r.correct ? "same output" : "DIFFERENT OUTPUT"}`,
    );
  }
  if (!n) out.push(`  ${r.runs} seeded runs · baseline median ${(r.baselineMedianMs / 1000).toFixed(2)} s · candidate median ${(r.candidateMedianMs / 1000).toFixed(2)} s`);
  if (r.claimCheck) {
    out.push(
      `  tuner claimed ${r.claimCheck.claimedSpeedup}× on ${r.claimCheck.tunerGpu}; measured ${r.speedup}× (needs ≥ ${r.claimCheck.required}×) → ${r.claimCheck.ok ? "claim holds" : "CLAIM NOT MET"}`,
    );
  }
  out.push(`  correct ${r.correct ? "yes" : "NO"} · speedup ${r.speedup}× · noise ±${r.noisePct}% → ${r.pass ? "PASS" : "FAIL"}`);
  out.push("  committed, then revealed once every verifier had committed.");
  return out;
}

/** The pass rule, with this verifier's numbers. Mirrors verifyOne() in the agent. */
function checksOf(r: VerifyReport, lines: string[], tolerance: number): Check[] {
  if (!r.compatible) return [{ label: "Can run the build", ok: false, detail: r.reason ?? "not compatible" }];
  const gain = (r.speedup - 1) * 100;
  const runs = runsOf(r, lines);
  const checks: Check[] = [
    { label: "Exact code", ok: r.hashMatches, detail: r.hashMatches ? "the downloaded files hash to the submitted SHA-256" : "the files didn't match the submitted hash" },
    {
      label: "Same output",
      ok: r.correct,
      detail: r.correct
        ? `matches the baseline within ${tolerance} on every seed${r.maxError != null ? ` (largest difference ${r.maxError.toExponential(1)})` : ""}`
        : "different output from the baseline on at least one seed",
    },
    ...(r.claimCheck
      ? [
          {
            label: "At least the tuner's claim",
            ok: r.claimCheck.ok,
            detail: `tuner claimed at least ${r.claimCheck.claimedSpeedup}× on ${r.claimCheck.tunerGpu}; this verifier measured ${r.speedup}× (needs at least ${r.claimCheck.required}×: the claim less at least 5% for measurement drift)`,
          },
        ]
      : []),
    { label: `At least ${MIN_GAIN_PCT}% faster`, ok: gain >= MIN_GAIN_PCT, detail: `${gain.toFixed(2)}% faster by median time` },
    { label: "Beyond the noise", ok: gain > 2 * r.noisePct, detail: `${gain.toFixed(1)}% gain vs ±${r.noisePct}% run-to-run noise (needs more than twice it)` },
  ];
  if (runs) {
    const slowest = Math.max(...runs.cand);
    const fastest = Math.min(...runs.base);
    checks.push({
      label: "Every run faster",
      ok: slowest < fastest,
      detail: `slowest build run ${slowest.toFixed(2)} s vs fastest baseline run ${fastest.toFixed(2)} s`,
    });
  }
  return checks;
}

function toleranceOf(trackId: string) {
  const file = path.join(process.cwd(), "tracks", trackId, "track.json");
  try {
    return existsSync(file) ? ((JSON.parse(readFileSync(file, "utf8")) as { tolerance?: number }).tolerance ?? 1e-3) : 1e-3;
  } catch {
    return 1e-3;
  }
}

export function verificationStory(data: Data, id: string, sessionId: string | null): VerificationStory | null {
  const sub = data.submissions.find((s) => s.id === id);
  if (!sub) return null;
  const approval = data.approvals.find((a) => a.id === sub.approvalId) ?? null;
  const tolerance = toleranceOf(sub.trackId);
  let n = 0;
  const verifiers: VerifierStory[] = data.assignments
    .filter((a) => a.submissionId === sub.id)
    .map((a) => {
      const platform = a.sessionId === PLATFORM_SESSION;
      const who = platform ? "Platform harness" : a.sessionId === sessionId ? "You" : `Verifier ${++n}`;
      const agent = data.agents.find((g) => g.sessionId === a.sessionId);
      const r = a.report;
      if (!r) {
        return {
          who,
          hardware: agent ? [agent.gpus[0]?.name, agent.cpu].filter(Boolean).join(" + ") : "",
          platform,
          source: "running",
          lines: [`▶ ${sub.id} · ${sub.trackId} · ${sub.buildName}`, platform && harnessRunning() ? "  running baseline vs this build now…" : "  waiting for this verifier to run it…"],
          checks: [],
          runs: null,
          noisePct: null,
          speedup: null,
          pass: null,
        };
      }
      const logged = platform ? harnessLines(sub.id) : null;
      const lines = logged ?? linesFromReport(sub, r);
      return {
        who,
        hardware: r.hardware,
        platform,
        source: logged ? "harness log" : "report",
        lines,
        checks: checksOf(r, lines, tolerance),
        runs: r.compatible ? runsOf(r, lines) : null,
        noisePct: r.compatible ? r.noisePct : null,
        speedup: r.compatible ? r.speedup : null,
        pass: r.compatible ? r.pass : null,
      };
    });

  return {
    id: sub.id,
    track: findTrack(sub.trackId)?.name ?? sub.trackId,
    trackId: sub.trackId,
    buildName: sub.buildName,
    buildSha256: sub.buildSha256,
    resultSha256: sub.resultSha256,
    gpu: sub.gpu,
    seconds: sub.seconds,
    status: sub.status,
    speedup: sub.speedup,
    submittedAt: sub.at,
    settledAt: sub.settledAt,
    tuneLog: sub.tuneLog?.length ? sub.tuneLog : null,
    approval: approval
      ? {
          worldId: approval.kind === "worldid" && !!approval.nullifier,
          fee: approval.fee ? { digest: approval.fee.digest, amountSui: Number(approval.fee.amountMist) / 1e9 } : null,
        }
      : null,
    draw: sub.draw ? { source: sub.draw.source } : null,
    harness: !!sub.harness,
    harnessRunning: harnessRunning(),
    quorum: sub.quorum ?? QUORUM,
    verifiers,
    feeSettlement: sub.feeSettlement ? { digest: sub.feeSettlement.digest, recipients: sub.feeSettlement.recipients.length } : null,
    listing: sub.listing ? { id: sub.listing.id, digest: sub.listing.digest } : null,
    tolerance,
  };
}
