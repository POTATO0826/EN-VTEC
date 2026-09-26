/**
 * One-off: verifier reports from before the agent recorded every run only
 * hold the medians. The platform harness printed each run to
 * .data/harness.log, so its reports can get their per-run timings back.
 *
 *   bun scripts/backfill-harness-runs.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const store = path.join(root, ".data", "vtec.json");
const data = JSON.parse(readFileSync(store, "utf8")) as {
  assignments: {
    submissionId: string;
    sessionId: string;
    report: { baselineMedianMs: number; candidateMedianMs: number; baselineMs?: number[] } | null;
  }[];
};

// "▶ sub_x · track · build" starts a block; "run i/n seed s baseline 5.03 s candidate 4.87 s" lines follow.
const blocks = new Map<string, { base: number[]; cand: number[] }[]>();
let current: { base: number[]; cand: number[] } | null = null;
for (const line of readFileSync(path.join(root, ".data", "harness.log"), "utf8").split("\n")) {
  const head = line.match(/^▶ (sub_[0-9a-f]+)/);
  if (head) {
    current = { base: [], cand: [] };
    blocks.set(head[1], [...(blocks.get(head[1]) ?? []), current]);
    continue;
  }
  const run = line.match(/^ {2}run \d+\/\d+ .*baseline ([\d.]+) s +candidate ([\d.]+) s/);
  if (run && current) {
    current.base.push(Math.round(Number(run[1]) * 1000));
    current.cand.push(Math.round(Number(run[2]) * 1000));
  }
}

const median = (v: number[]) => [...v].sort((a, b) => a - b)[v.length >> 1];
let filled = 0;
for (const a of data.assignments) {
  if (a.sessionId !== "platform" || !a.report || a.report.baselineMs) continue;
  // The log rounds to 10 ms, so the block whose medians match the report within that is the right run.
  const block = (blocks.get(a.submissionId) ?? []).find(
    (b) =>
      b.base.length > 0 &&
      Math.abs(median(b.base) - a.report!.baselineMedianMs) <= 10 &&
      Math.abs(median(b.cand) - a.report!.candidateMedianMs) <= 10,
  );
  if (!block) {
    console.log(`no matching log block for ${a.submissionId}`);
    continue;
  }
  Object.assign(a.report, { baselineMs: block.base, candidateMs: block.cand });
  filled++;
}
writeFileSync(store, JSON.stringify(data, null, 2));
console.log(`filled ${filled} report(s)`);
