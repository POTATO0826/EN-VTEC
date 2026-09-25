/**
 * Invariant checks for the GPU VTEC fixtures.
 *
 * These are the claims the UI makes out loud. If a fixture ever drifts away
 * from one of them the product starts lying, so they are checked rather than
 * assumed.
 *
 *   bun scripts/check-vtec.ts
 */

import {
  REGISTRY,
  RUNS,
  SUMMARY,
  acceptedCandidate,
  buildPipeline,
  chartRows,
  completedSizes,
  gpuFor,
  msAt,
  winnerAtSize,
} from "../src/data/vtec";
import { VARIANTS } from "../src/data/vtec/variants";
import { canonicalPlanJson } from "../src/lib/plan";

let failures = 0;

function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

/* -------------------------------------------------------------------------- */

section("Plan hashes match the bytes that would be re-hashed in the browser");
for (const run of RUNS) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalPlanJson(run.plan)),
  );
  const hex =
    "0x" +
    Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  check(
    `${run.id}`,
    hex === run.planHash,
    `stored ${run.planHash.slice(0, 14)}… computed ${hex.slice(0, 14)}…`,
  );
}

section("Registry speedups agree with the measured curves");
for (const entry of REGISTRY) {
  const run = RUNS.find((item) => item.id === entry.runId)!;
  const index = run.plan.batchSizes.indexOf(entry.jobSize);
  const baseline = msAt(run, run.plan.baselineVariant, index);
  const chosen = msAt(run, entry.variant as never, index);
  const expected = Number((baseline! / chosen!).toFixed(4));
  check(
    `${entry.gpu} @ ${entry.jobSize}`,
    Math.abs(expected - entry.speedup) < 1e-6,
    `entry says ${entry.speedup}, curves say ${expected}`,
  );
}

section("Every accepted candidate actually clears its card's noise band");
for (const run of RUNS) {
  const accepted = acceptedCandidate(run);
  if (!accepted) {
    check(`${run.id} has no winner and says so`, run.status === "no-winner");
    continue;
  }
  check(
    `${run.id} — variant ${accepted.variant}`,
    (accepted.gainPct ?? 0) > run.noiseBand && accepted.correct,
    `gain ${accepted.gainPct}% against a ${run.noiseBand}% band`,
  );
}

section("Every rejection has a reason, and wrong kernels were never timed");
for (const run of RUNS) {
  for (const candidate of run.candidates) {
    check(
      `${run.id} — variant ${candidate.variant} carries a reason`,
      candidate.reason.trim().length > 0,
    );
    if (!candidate.correct) {
      check(
        `${run.id} — variant ${candidate.variant} was never timed`,
        candidate.medianMs === undefined && candidate.speedup === undefined,
      );
    }
  }
}

section("Every terminal pipeline node carries a reason string");
for (const run of RUNS) {
  const { nodes } = buildPipeline(run);
  const terminals = nodes.filter((node) => node.terminal);
  check(
    `${run.id} — ${terminals.length} terminal nodes`,
    terminals.length > 0 && terminals.every((node) => !!node.reason?.trim()),
  );
}

section("The single run still exercises the statuses the UI renders");
// This used to assert the six-run fixture set covered every status. There is one
// run now - the build plan is a single-laptop build - so the honest check is
// narrower: the statuses this run produces must all be renderable, and the ones
// it cannot produce are named rather than silently dropped.
const allStatuses = new Set(
  RUNS.flatMap((run) => buildPipeline(run).nodes.map((node) => node.status)),
);
for (const status of ["accepted", "rejected", "skipped", "published", "passed"]) {
  check(`${status} appears somewhere`, allStatuses.has(status as never));
}
check(
  "no status outside the declared set is produced",
  [...allStatuses].every((status) =>
    ["queued", "compiling", "processing", "passed", "accepted", "rejected", "failed", "skipped", "published"].includes(
      status,
    ),
  ),
  [...allStatuses].join(", "),
);
// "failed" and "no-winner" are rendered by components that this run never
// reaches. They are covered by the canvas checks against synthesised nodes
// instead, and by whatever the spike actually produces.

section("The registry makes no cross-hardware claim");
// Deleted, not weakened: this section used to assert that different cards reach
// different winners. Build plan section 0 makes that a hard stop and section
// 17.6 says never to state it as a measured result - this build uses one GPU.
// A test that enforced the forbidden claim would have kept it alive in the UI.
check(
  "the registry describes exactly one card",
  new Set(REGISTRY.map((entry) => entry.gpu)).size === 1,
  [...new Set(REGISTRY.map((entry) => entry.gpu))].join(", "),
);
// What survives is the claim section 11a exists to prove, on one card.
const winnersByGpu = new Map<string, Set<string>>();
for (const entry of REGISTRY) {
  const set = winnersByGpu.get(entry.gpu) ?? new Set<string>();
  set.add(entry.variant);
  winnersByGpu.set(entry.gpu, set);
}
check(
  "the card changes its winner with job size",
  [...winnersByGpu.values()].some((set) => set.size > 1),
);

section("The dispatcher line shows what the registry actually selects");
for (const run of RUNS) {
  const rows = chartRows(run);
  check(
    `${run.id} — dispatcher is the lowest value that cleared the band`,
    rows.every((row) => {
      const baseline = row[run.plan.baselineVariant] as number;
      const cleared = Object.entries(row)
        .filter(([key]) => key !== "jobSize" && key !== "dispatcher")
        .map(([, value]) => value as number)
        .filter(
          (value) =>
            typeof value === "number" &&
            ((baseline - value) / baseline) * 100 > run.noiseBand,
        );
      // Where nothing cleared the band the dispatcher runs the baseline. That
      // is higher than the fastest measured variant, and saying so is the point.
      const expected = cleared.length > 0 ? Math.min(...cleared) : baseline;
      return row.dispatcher !== null && Math.abs(row.dispatcher - expected) < 1e-9;
    }),
  );
}
const crossovers = RUNS.filter((run) => {
  const sizes = completedSizes(run);
  const first = winnerAtSize(run, sizes[0])?.variant;
  const last = winnerAtSize(run, sizes[sizes.length - 1])?.variant;
  return first !== last;
});
check(
  `${crossovers.length} of ${RUNS.length} runs contain a crossover`,
  crossovers.length === RUNS.length,
  crossovers.map((run) => run.id).join(", "),
);

section("Skip reasons quote the working set the plan actually implies");
for (const run of RUNS) {
  for (const entry of run.skipped) {
    // Reasons are written the way nvidia-smi talks: decimal GB.
    const neededGb = (entry.jobSize * run.plan.messageLengthBytes) / 1e9;
    const cardGb = (gpuFor(run).vramMb * 1024 ** 2) / 1e9;
    const quoted = entry.reason.match(/needs ([\d.]+) GB/)?.[1];
    check(
      `${gpuFor(run).name} skips ${entry.jobSize} — reason quotes the right size`,
      quoted === neededGb.toFixed(1),
      `reason says ${quoted} GB, the plan implies ${neededGb.toFixed(1)} GB`,
    );
    check(
      `${gpuFor(run).name} skips ${entry.jobSize} — it genuinely would not fit`,
      neededGb > cardGb * 0.9,
      `needs ${neededGb.toFixed(1)} GB on a ${cardGb.toFixed(1)} GB card`,
    );
  }
}

section("No reason line blames VRAM size for register pressure");
const reasons = [
  ...RUNS.map((run) => run.dispatcher.reason),
  ...RUNS.flatMap((run) => run.candidates.map((c) => c.reason)),
  ...Object.values(VARIANTS).map((variant) => variant.detail),
];
const badPattern = /(vram|memory size|gb).{0,60}(spill|register)/i;
check(
  `${reasons.length} reason lines checked`,
  reasons.every((reason) => !badPattern.test(reason)),
  reasons.find((reason) => badPattern.test(reason)) ?? "",
);

section("Homepage summary agrees with the fixtures");
check(
  "best speedup is the largest in the registry",
  SUMMARY.best.speedup === Math.max(...REGISTRY.map((entry) => entry.speedup)),
);
check(
  "verified result count equals the registry size",
  SUMMARY.verifiedResults === REGISTRY.length,
);

/* -------------------------------------------------------------------------- */

console.log(
  failures === 0
    ? `\nAll checks passed. ${RUNS.length} runs, ${REGISTRY.length} registry entries.`
    : `\n${failures} check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
