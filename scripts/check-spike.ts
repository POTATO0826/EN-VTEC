/**
 * Validates crossover spike output and enforces section 11a's gate.
 *
 *   bun run check:spike
 *
 * Reads every crossover_*.json in artifacts/spike/, checks each is structurally
 * sound, prints the winner per job size, and - when there are two or more -
 * checks the winners agree across sessions. Section 11a is explicit that if they
 * do not, "noise is larger than the differences and results aren't usable yet".
 *
 * Exits non-zero when a file is malformed or the sessions disagree, so this can
 * gate a build rather than being a thing someone remembers to look at.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  compareSessions,
  summariseSpike,
  validateSpike,
  type SpikeFile,
} from "../src/data/spike";

// Overridable so the gate itself can be tested against fixtures without
// putting fake measurements anywhere near artifacts/spike/.
const DIR = process.argv[2] ?? "artifacts/spike";

let failures = 0;

function fail(message: string) {
  failures += 1;
  console.log(`  FAIL  ${message}`);
}

function ok(message: string) {
  console.log(`  ok    ${message}`);
}

function section(title: string) {
  console.log(`\n${title}`);
}

/* -------------------------------------------------------------------------- */

if (!existsSync(DIR)) {
  console.log(`\nNo ${DIR}/ yet.`);
  console.log("The crossover spike has not been run. Section 11a, milestone M1.5:");
  console.log("  pip install cupy-cuda12x");
  console.log("  python crossover_test.py        (twice, a few minutes apart)");
  console.log("\nNothing to check. This is not a failure - it is the gate being open.");
  process.exit(0);
}

const files = readdirSync(DIR)
  .filter((name) => name.startsWith("crossover_") && name.endsWith(".json"))
  .sort();

if (files.length === 0) {
  console.log(`\n${DIR}/ exists but holds no crossover_*.json files.`);
  console.log("Run the spike twice and drop both outputs here.");
  process.exit(0);
}

section(`Found ${files.length} spike file(s) in ${DIR}/`);

const parsed: { name: string; file: SpikeFile }[] = [];

for (const name of files) {
  const path = join(DIR, name);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${name} is not valid JSON - ${(error as Error).message}`);
    continue;
  }

  const problems = validateSpike(raw);
  if (problems.length > 0) {
    fail(`${name} is malformed`);
    for (const problem of problems.slice(0, 12)) {
      console.log(`          ${problem.path || "(root)"}: ${problem.detail}`);
    }
    if (problems.length > 12) {
      console.log(`          ... and ${problems.length - 12} more`);
    }
    continue;
  }

  ok(`${name} is well formed`);
  parsed.push({ name, file: raw as SpikeFile });
}

if (parsed.length === 0) {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
}

/* -------------------------------------------------------------------------- */

for (const { name, file } of parsed) {
  section(`${name}`);
  console.log(
    `  ${file.gpu} | ${file.vram_mb} MB | ${file.sm_count} SMs | ` +
      `${file.msg_len}-byte messages | ${file.runs} timed runs`,
  );

  const summary = summariseSpike(file);
  for (const row of summary.winners) {
    console.log(
      `  ${row.jobSize.toLocaleString("en-US").padStart(11)} -> ` +
        `${row.winner.padEnd(16)} ${row.speedup.toFixed(2)}x  ` +
        `noise band ${row.noiseBandPct.toFixed(1)}%`,
    );
  }

  if (summary.hasCrossover) {
    ok(`crossover present - winner changes with job size (${summary.distinctWinners.join(", ")})`);
  } else {
    // Not a failure. Section 11a's decision table treats this as a real answer:
    // it means SHA-256 is not the workload, and the Transformer target is.
    console.log(
      `  note  no crossover - "${summary.distinctWinners[0]}" wins at every size.\n` +
        "        Section 11a decision table: use the Transformer workload and\n" +
        "        pitch the release lifecycle, not the crossover.",
    );
  }

  // The spike's numbers decide a workload. They are not a published result.
  if (file.runs < 20) {
    console.log(
      `  note  ${file.runs} timed runs per case. Section 6 targets 100 paired\n` +
        "        observations across three sessions before anything is published,\n" +
        "        so these numbers pick the workload and go no further.",
    );
  }
}

/* -------------------------------------------------------------------------- */

section("Section 11a gate: two sessions must agree");

if (parsed.length < 2) {
  fail(
    "only one session recorded - section 11a requires the spike run twice, " +
      "a few minutes apart, before the result may be used",
  );
} else {
  // Compare every session against the first. More than two is fine and stricter.
  const [base, ...rest] = parsed;
  for (const other of rest) {
    const comparison = compareSessions(base.file, other.file);

    if (comparison.onlyInOne.length > 0) {
      fail(
        `${base.name} and ${other.name} cover different job sizes ` +
          `(${comparison.onlyInOne.map((n) => n.toLocaleString("en-US")).join(", ")})`,
      );
    }

    for (const row of comparison.rows) {
      if (!row.same) {
        console.log(
          `  FAIL  ${row.jobSize.toLocaleString("en-US").padStart(11)} -> ` +
            `${row.first} then ${row.second}`,
        );
      }
    }

    if (comparison.agree) {
      ok(`${base.name} and ${other.name} agree on every job size`);
    } else {
      failures += 1;
      console.log(
        `\n  Winners changed between sessions. Section 11a: noise is larger than\n` +
          "  the differences and the results are not usable yet. Check the\n" +
          "  section 6a controls - plugged in, performance mode, no background GPU\n" +
          "  load, cooled between runs - and run it again.",
      );
    }
  }
}

/* -------------------------------------------------------------------------- */

console.log(
  failures === 0
    ? `\nAll checks passed. ${parsed.length} session(s).`
    : `\n${failures} check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
