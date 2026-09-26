import "server-only";
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";

/**
 * The platform harness: when there aren't enough human verifiers, the
 * platform runs the same verification agent on its own machine. It counts as
 * one verifier, is labelled as such everywhere, and never needs World ID
 * because it isn't a person.
 */

export const PLATFORM_SESSION = "platform";
export const PLATFORM_CODE = "PLATFORM";
export const HARNESS_ENABLED = (process.env.PLATFORM_HARNESS ?? "1") !== "0";

// Next.js can load this module more than once (one copy per route bundle),
// so the "is it running" flag lives on globalThis, shared by every copy.
// Only one harness may run at a time: two would compete for the same CPU/GPU
// and skew every timing.
const state = ((globalThis as { __vtecHarness?: { running: boolean; again: boolean } }).__vtecHarness ??= {
  running: false,
  again: false,
});

/** Starts the harness agent; if it's already running, runs once more after. */
export function runHarness() {
  if (state.running) {
    state.again = true;
    return;
  }
  state.running = true;
  state.again = false;

  const root = process.cwd();
  const logs = path.join(root, ".data");
  mkdirSync(logs, { recursive: true });
  const log = createWriteStream(path.join(logs, "harness.log"), { flags: "a" });
  log.write(`\n=== ${new Date().toISOString()} platform harness\n`);

  const url = process.env.VTEC_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`;
  const child = spawn(
    "bun",
    [path.join(root, "agent", "vtec-agent.ts"), "verify", PLATFORM_CODE, "--runs", process.env.HARNESS_RUNS ?? "4", "--url", url],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.on("close", (code) => {
    log.end(`=== exit ${code}\n`);
    state.running = false;
    if (state.again) runHarness();
  });
  child.on("error", (e) => {
    log.end(`=== failed to start: ${e.message}\n`);
    state.running = false;
  });
}

export function harnessRunning() {
  return state.running;
}
