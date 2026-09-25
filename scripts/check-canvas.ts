/**
 * Invariant checks for the pipeline canvas.
 *
 * Same idea as check-vtec.ts, one level up: these are the claims the *graph*
 * makes — that hovering isolates a path, that the agent only ever walks wires
 * that exist, and that a replay ends holding exactly the statuses the run
 * recorded. The first of those is here because it was silently false for the
 * life of the previous graph.
 *
 *   bun scripts/check-canvas.ts
 */

import { RUNS, buildPipeline } from "../src/data/vtec";
import {
  buildJourney,
  legAtProgress,
  progressAtElapsed,
  elapsedAtProgress,
  statusAtProgress,
} from "../src/data/vtec/journey";
import { edgeOnPath, isolatePath } from "../src/components/graph/isolate";

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

section("Hovering a variant isolates its path and dims the others");
for (const run of RUNS) {
  const pipeline = buildPipeline(run);
  const pool = run.plan.variantPool;

  for (const variant of pool) {
    const keep = isolatePath(pipeline.edges, `var-${variant}`);

    // Its own chain, and the spine above and below it, stay.
    check(
      `${run.id} · variant ${variant} keeps its own branch`,
      keep.has("plan") &&
        keep.has("commit") &&
        keep.has(`var-${variant}`) &&
        keep.has(`corr-${variant}`),
    );

    // Every other variant's modules go. This is the assertion the old
    // bidirectional closure could never satisfy.
    const others = pool.filter((item) => item !== variant);
    const leaked = others.filter(
      (item) => keep.has(`var-${item}`) || keep.has(`corr-${item}`),
    );
    check(
      `${run.id} · variant ${variant} dims the other ${others.length} branches`,
      leaked.length === 0,
      leaked.length ? `leaked ${leaked.join(", ")}` : "",
    );

    // And something is actually dimmed, so "keeps everything" cannot pass.
    check(
      `${run.id} · variant ${variant} dims part of the graph`,
      keep.size < pipeline.nodes.length,
      `kept ${keep.size} of ${pipeline.nodes.length}`,
    );
  }

  // Edges follow their endpoints.
  const keepA = isolatePath(pipeline.edges, `var-${pool[0]}`);
  const litEdges = pipeline.edges.filter((edge) => edgeOnPath(edge, keepA));
  check(
    `${run.id} · no lit edge touches a dimmed module`,
    litEdges.every(
      (edge) => keepA.has(edge.source) && keepA.has(edge.target),
    ),
  );
}

section("Every leg the agent walks is an edge the graph actually has");
for (const run of RUNS) {
  const pipeline = buildPipeline(run);
  const journey = buildJourney(run, pipeline);
  const ids = new Set(pipeline.edges.map((edge) => edge.id));
  const unknown = journey.legs.filter((leg) => !ids.has(leg.edgeId));
  check(
    `${run.id} · ${journey.legs.length} legs`,
    unknown.length === 0,
    unknown.map((leg) => leg.edgeId).join(", "),
  );

  const nodeIds = new Set(pipeline.nodes.map((node) => node.id));
  const orphan = journey.legs.filter(
    (leg) => !nodeIds.has(leg.source) || !nodeIds.has(leg.target),
  );
  check(`${run.id} · every leg joins two real modules`, orphan.length === 0);
}

section("Every module is reached, and the route visits each branch once");
for (const run of RUNS) {
  const pipeline = buildPipeline(run);
  const journey = buildJourney(run, pipeline);

  const missing = pipeline.nodes.filter(
    (node) => !journey.arrival.has(node.id),
  );
  check(`${run.id} · no module without an arrival`, missing.length === 0,
    missing.map((node) => node.id).join(", "));

  // A branch walked twice would read as the agent losing its place.
  const entries = journey.legs.filter(
    (leg) => !leg.reverse && leg.source === "commit",
  );
  const variants = entries.map((leg) => leg.target);
  check(
    `${run.id} · each variant entered exactly once`,
    new Set(variants).size === variants.length,
    variants.join(", "),
  );
}

section("The run commits to the variant the fixtures say won");
for (const run of RUNS) {
  const pipeline = buildPipeline(run);
  const journey = buildJourney(run, pipeline);
  const accepted = run.candidates.find(
    (candidate) => candidate.verdict === "accepted",
  );

  check(
    `${run.id} · selected ${journey.selected}`,
    journey.selected === (accepted?.variant ?? run.plan.baselineVariant),
  );
  check(
    `${run.id} · hasWinner agrees with the run status`,
    journey.hasWinner === (run.status !== "no-winner"),
  );

  // The publish leg must leave the gate the run actually committed to.
  const publish = journey.legs.find((leg) => leg.target === "registry");
  check(
    `${run.id} · the registry is fed by gate-${journey.selected}`,
    publish?.source === `gate-${journey.selected}`,
    `got ${publish?.source ?? "nothing"}`,
  );
}

section("A finished replay holds exactly the statuses the run recorded");
for (const run of RUNS) {
  const pipeline = buildPipeline(run);
  const journey = buildJourney(run, pipeline);
  const end = journey.legs.length;

  const wrong = pipeline.nodes.filter(
    (node) => statusAtProgress(node, journey, end) !== node.status,
  );
  check(`${run.id} · ${pipeline.nodes.length} modules settle`, wrong.length === 0,
    wrong.map((node) => node.id).join(", "));

  const live = pipeline.nodes.filter(
    (node) => statusAtProgress(node, journey, 0) !== "queued",
  );
  check(`${run.id} · everything is queued before the run starts`, live.length === 0,
    live.map((node) => node.id).join(", "));
}

section("The clock is monotonic and seeks back to where it came from");
for (const run of RUNS) {
  const pipeline = buildPipeline(run);
  const journey = buildJourney(run, pipeline);

  let previous = -1;
  let monotonic = true;
  for (let elapsed = 0; elapsed <= journey.totalMs; elapsed += 40) {
    const progress = progressAtElapsed(journey, elapsed);
    if (progress < previous) monotonic = false;
    previous = progress;
  }
  check(`${run.id} · progress never goes backwards`, monotonic);

  let roundTrips = true;
  for (let leg = 0; leg <= journey.legs.length; leg += 1) {
    const back = progressAtElapsed(journey, elapsedAtProgress(journey, leg));
    if (Math.abs(back - leg) > 1e-6) roundTrips = false;
  }
  check(`${run.id} · seek and play agree`, roundTrips);

  check(
    `${run.id} · the run lasts ${(journey.totalMs / 1000).toFixed(1)}s`,
    journey.totalMs >= 8000 && journey.totalMs <= 15000,
  );

  const midpoint = legAtProgress(journey, journey.legs.length / 2);
  check(`${run.id} · the agent has a leg at the midpoint`, midpoint !== null);
  check(
    `${run.id} · no agent before the run starts`,
    legAtProgress(journey, 0) === null,
  );
}

/* -------------------------------------------------------------------------- */

console.log(
  failures === 0
    ? `\nAll checks passed. ${RUNS.length} runs.`
    : `\n${failures} check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
