#!/usr/bin/env bun
/**
 * VTEC local agent.
 *
 *   bun agent/vtec-agent.ts pair <CODE>
 *       Reads this machine's GPU/CPU and pairs with the browser session that
 *       showed <CODE> on the Get started page.
 *
 *   bun agent/vtec-agent.ts submit <CODE> --track <id> [--build <dir>] [--run "<command>"]
 *       Without --build the agent tunes a kernel for this GPU itself (random
 *       variants from the track's template, checked and timed here) and
 *       submits the fastest correct one.
 *       Hashes the build (SHA-256), runs it, hashes its output and uploads the
 *       exact files. The submission starts as PENDING until verifiers agree.
 *       --run defaults to the "run" command in the build's vtec.json. The
 *       baseline can't be submitted: it's what every build is measured against.
 *
 *   bun agent/vtec-agent.ts verify <CODE> [--runs 5]
 *       Runs every verification you approved with World ID: checks this
 *       machine can run the build, downloads the exact code, runs baseline and
 *       candidate alternately, then commits and later reveals the report.
 *
 *   bun agent/vtec-agent.ts reveal <CODE>
 *       Reveals reports saved by an earlier `verify` that timed out waiting.
 *
 * Options: --url <app url>  (default http://127.0.0.1:3000, or VTEC_URL)
 */
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const [command, code] = args;
const REPO = path.resolve(import.meta.dir, "..");
const REVEALS = path.join(os.homedir(), ".vtec", "reveals");
// Builds say "{python}" and get the project's own Python (with CuPy), so the
// same vtec.json works wherever the build folder lives.
const PYTHON = [
  path.join(REPO, ".venv", "Scripts", "python.exe"),
  path.join(REPO, ".venv", "bin", "python"),
].find((p) => existsSync(p)) ?? "python";

function flag(name: string) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

const URL_BASE = (flag("url") ?? process.env.VTEC_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

/* -------------------------------------------------------------------------- */
/* Hardware                                                                    */
/* -------------------------------------------------------------------------- */

type Gpu = { name: string; memoryMb: number | null; driver: string | null };

function detectGpus(): Gpu[] {
  // NVIDIA first: nvidia-smi gives the exact name, memory and driver.
  const smi = spawnSync(
    "nvidia-smi",
    ["--query-gpu=name,memory.total,driver_version", "--format=csv,noheader,nounits"],
    { encoding: "utf8" },
  );
  if (smi.status === 0 && smi.stdout.trim()) {
    return smi.stdout
      .trim()
      .split("\n")
      .map((line) => {
        const [name, memory, driver] = line.split(",").map((s) => s.trim());
        return { name, memoryMb: Number(memory) || null, driver: driver || null };
      });
  }

  // Anything else on Windows: ask WMI.
  if (process.platform === "win32") {
    const wmi = spawnSync(
      "powershell",
      ["-NoProfile", "-Command", "Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name + '|' + $_.DriverVersion }"],
      { encoding: "utf8" },
    );
    if (wmi.status === 0) {
      return wmi.stdout
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
          const [name, driver] = line.split("|");
          return { name: name.trim(), memoryMb: null, driver: driver?.trim() || null };
        });
    }
  }
  return [];
}

function cpuName() {
  return os.cpus()[0]?.model.trim() ?? "unknown CPU";
}

type Requirements = { nvidiaDriver?: string };

/** Can this machine run a build with these requirements? */
function checkCompatible(requires: Requirements): { ok: true } | { ok: false; reason: string } {
  if (requires.nvidiaDriver) {
    const nvidia = detectGpus().find((g) => /nvidia/i.test(g.name));
    if (!nvidia?.driver) return { ok: false, reason: "needs an NVIDIA GPU" };
    if (Number.parseFloat(nvidia.driver) < Number.parseFloat(requires.nvidiaDriver)) {
      return { ok: false, reason: `needs NVIDIA driver ${requires.nvidiaDriver}+, this machine has ${nvidia.driver}` };
    }
  }
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Builds                                                                      */
/* -------------------------------------------------------------------------- */

/** Every file in the build, relative path -> base64. */
function readBuild(dir: string) {
  const files: Record<string, string> = {};
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      if (entry === "node_modules" || entry === ".git") continue;
      const full = path.join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else files[path.relative(dir, full).replaceAll("\\", "/")] = readFileSync(full).toString("base64");
    }
  };
  walk(dir);
  return files;
}

/** SHA-256 over path + bytes of every file, in sorted path order. The server recomputes this. */
function hashFiles(files: Record<string, string>) {
  const h = createHash("sha256");
  for (const name of Object.keys(files).sort()) {
    h.update(name);
    h.update(Buffer.from(files[name], "base64"));
  }
  return h.digest("hex");
}

/** Build folders for a track, apart from the baseline. */
function listBuilds(trackId: string) {
  const dir = path.join(REPO, "tracks", trackId);
  if (!existsSync(dir)) fail(`Unknown track: ${trackId}`);
  return readdirSync(dir).filter(
    (name) => name !== "baseline" && existsSync(path.join(dir, name, "vtec.json")),
  );
}

function manifestOf(dir: string) {
  const file = path.join(dir, "vtec.json");
  return existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as { name?: string; run?: string; requires?: Requirements })
    : {};
}

/**
 * Runs a build once. VTEC_SEED varies the input so answers can't be
 * hardcoded; VTEC_OUT is where builds that produce a file must write it.
 * Returns wall time and the SHA-256 of what it printed.
 */
function runOnce(dir: string, run: string, seed = "0", out?: string) {
  const started = performance.now();
  const result = spawnSync(run.replaceAll("{python}", `"${PYTHON}"`), {
    shell: true,
    cwd: dir,
    encoding: "buffer",
    env: { ...process.env, VTEC_SEED: seed, ...(out ? { VTEC_OUT: out } : {}) },
  });
  const ms = performance.now() - started;
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    fail(`Run failed in ${dir} (exit ${result.status}).`);
  }
  return { ms, sha256: createHash("sha256").update(result.stdout).digest("hex") };
}

type TuneConfig = {
  template: string;
  file: string;
  requires?: Requirements;
  params: Record<string, (string | number)[]>;
  /** name -> expression over the params, e.g. "1024 / THREADS" */
  derived?: Record<string, string>;
  samples?: number;
};
type TrackConfig = { output?: string; compare?: "tensor"; tolerance?: number; tune?: TuneConfig };

/** tracks/<id>/track.json: what a build writes and how outputs are compared. */
function trackConfig(trackId: string): TrackConfig {
  const file = path.join(REPO, "tracks", trackId, "track.json");
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as TrackConfig) : {};
}

/** Every combination of the tune parameters, e.g. THREADS x LOAD. */
function combinations(params: Record<string, (string | number)[]>) {
  let out: Record<string, string | number>[] = [{}];
  for (const [key, values] of Object.entries(params)) {
    out = out.flatMap((combo) => values.map((v) => ({ ...combo, [key]: v })));
  }
  return out;
}

/**
 * The agent's own optimisation loop, on this GPU: generate kernel variants
 * from the track's template (a random sample of the parameter space), check
 * each one's output against the baseline on a random seed, time it, and keep
 * the fastest correct one. Different runs explore different variants, so each
 * submission is new code.
 */
function autotune(track: string, tune: TuneConfig) {
  const trackDir = path.join(REPO, "tracks", track);
  const template = readFileSync(path.join(trackDir, tune.template), "utf8");
  const cfg = trackConfig(track);
  const ext = path.extname(cfg.output ?? "out.bin");

  const all = combinations(tune.params).sort(() => Math.random() - 0.5);
  const picked = all.slice(0, Math.min(tune.samples ?? 4, all.length));
  const seed = String(randomBytes(2).readUInt16BE() % 1000);

  mkdirSync(path.join(REPO, ".vtec-runs"), { recursive: true });
  const work = mkdtempSync(path.join(REPO, ".vtec-runs", `tune-${track}-`));
  console.log(
    `• tuning ${track} on ${detectGpus()[0]?.name ?? "this machine"}: ${picked.length} of ${all.length} variants, seed ${seed}`,
  );

  const baseline = path.join(trackDir, "baseline");
  const baseOut = path.join(work, `baseline${ext}`);
  const base = runOnce(baseline, manifestOf(baseline).run!, seed, baseOut);
  console.log(`  ${"baseline".padEnd(28)} ${(base.ms / 1000).toFixed(2)} s`);

  let best: { dir: string; ms: number; label: string } | null = null;
  picked.forEach((combo, i) => {
    const values: Record<string, string | number> = { ...combo };
    for (const [name, expr] of Object.entries(tune.derived ?? {})) {
      // Expressions come from the repo's own track.json, not from the network.
      values[name] = new Function(...Object.keys(values), `return (${expr});`)(...Object.values(values));
    }
    let code = template;
    for (const [key, value] of Object.entries(values)) code = code.replaceAll(`{{${key}}}`, String(value));

    const label = Object.entries(combo)
      .map(([k, v]) => `${k.toLowerCase()}=${v}`)
      .join(" ");
    const dir = path.join(work, `variant-${i + 1}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, tune.file), code);
    writeFileSync(
      path.join(dir, "vtec.json"),
      JSON.stringify({ name: `auto-tuned (${label})`, run: `{python} ${tune.file}`, requires: tune.requires ?? {} }, null, 2),
    );

    const out = path.join(dir, `out${ext}`);
    const run = runOnce(dir, `{python} ${tune.file}`, seed, out);
    const correct = sameTensor(baseOut, out, cfg.tolerance ?? 1e-3);
    rmSync(out, { force: true });
    console.log(
      `  ${label.padEnd(28)} ${(run.ms / 1000).toFixed(2)} s  ${(base.ms / run.ms).toFixed(2)}×  ${correct ? "correct" : "WRONG, dropped"}`,
    );
    if (correct && (!best || run.ms < best.ms)) best = { dir, ms: run.ms, label };
  });

  const winner = best as { dir: string; ms: number; label: string } | null;
  if (!winner) fail("No variant produced the right output. Nothing to submit.");
  rmSync(baseOut, { force: true });
  console.log(`• best: ${winner.label}, ${(base.ms / winner.ms).toFixed(2)}× on this GPU (verifiers will re-check)`);
  return winner.dir;
}

/** Two .npy tensors match within a float tolerance (different kernels round differently). */
function sameTensor(a: string, b: string, tolerance: number) {
  if (!existsSync(a) || !existsSync(b)) return false;
  const check = spawnSync(
    PYTHON,
    [
      "-c",
      "import sys, numpy as np; a=np.load(sys.argv[1]); b=np.load(sys.argv[2]); " +
        "print('ok' if a.shape==b.shape and np.isfinite(b).all() and float(np.abs(a-b).max())<=float(sys.argv[3]) else 'bad')",
      a,
      b,
      String(tolerance),
    ],
    { encoding: "utf8" },
  );
  return check.stdout.trim().endsWith("ok");
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/* -------------------------------------------------------------------------- */
/* HTTP                                                                        */
/* -------------------------------------------------------------------------- */

async function call(route: string, body?: unknown) {
  let res: Response;
  try {
    res = await fetch(`${URL_BASE}${route}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    fail(`Can't reach ${URL_BASE}. Is the app running?`);
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

async function post(route: string, body: unknown) {
  const { ok, status, data } = await call(route, body);
  if (!ok) fail(String(data.detail ?? data.error ?? `HTTP ${status}`));
  return data;
}

/* -------------------------------------------------------------------------- */
/* Commands                                                                    */
/* -------------------------------------------------------------------------- */

async function pair() {
  if (!code) fail("Usage: vtec-agent pair <CODE>");
  const gpus = detectGpus();
  const info = { code, hostname: os.hostname(), os: `${os.type()} ${os.release()}`, cpu: cpuName(), gpus };
  await post("/api/agent/hello", info);
  console.log(`✓ Paired ${info.hostname}`);
  for (const gpu of gpus) {
    console.log(`  GPU  ${gpu.name}${gpu.memoryMb ? ` · ${gpu.memoryMb} MB` : ""}${gpu.driver ? ` · driver ${gpu.driver}` : ""}`);
  }
  if (gpus.length === 0) console.log("  No GPU found, the CPU will be used.");
  console.log(`  CPU  ${info.cpu}`);
}

async function submit() {
  const track = flag("track");
  if (!code || !track) fail('Usage: vtec-agent submit <CODE> --track <id> --build <dir> [--run "<command>"]');

  // No --build: the agent tunes a kernel for this GPU itself and submits the
  // winner. The baseline is the reference everything is measured against, so
  // it can never be submitted.
  const builds = listBuilds(track);
  const options = builds.map((b) => `    --build tracks/${track}/${b}`).join("\n");
  const choice = flag("build");
  const tune = trackConfig(track).tune;
  if (!choice && !tune) fail(`Say which build to submit with --build. Available for ${track}:\n${options}`);
  const build = choice ? path.resolve(choice) : autotune(track, tune!);
  if (!existsSync(build)) fail(`Build folder not found: ${build}`);
  if (build === path.resolve(REPO, "tracks", track, "baseline")) {
    fail(
      "That's the baseline: the reference every build is compared with, so it can't be faster than itself.\n" +
        `  Try one of:\n${options}`,
    );
  }
  const manifest = manifestOf(build);
  const run = flag("run") ?? manifest.run;
  if (!run) fail(`No --run given and no "run" in ${path.join(build, "vtec.json")}`);
  if (manifest.name) console.log(`• build  ${manifest.name}`);

  const compat = checkCompatible(manifest.requires ?? {});
  if (!compat.ok) fail(`This machine can't run the build: ${compat.reason}.`);

  // Hash before running, so nothing the run writes can change the code hash.
  const files = readBuild(build);
  const buildSha256 = hashFiles(files);
  console.log(`• code   sha256 ${buildSha256}`);

  const { ms, sha256: resultSha256 } = runOnce(build, run);
  console.log(`• output sha256 ${resultSha256}`);
  console.log(`• time   ${(ms / 1000).toFixed(3)} s`);

  const data = await post("/api/agent/submit", {
    code,
    trackId: track,
    buildName: manifest.name ?? path.basename(build),
    buildSha256,
    resultSha256,
    seconds: ms / 1000,
    requires: manifest.requires ?? {},
    files,
  });
  console.log(`✓ Submitted ${data.id}: pending verification. It reaches the ranking once verifiers agree.`);
}

type Job = {
  assignmentId: string;
  status: "approved" | "committed";
  revealOpen: boolean;
  submission: { id: string; trackId: string; buildName: string; buildSha256: string; requires: Requirements };
};

async function verifyOne(job: Job, runs: number) {
  const sub = job.submission;
  console.log(`\n▶ ${sub.id} · ${sub.trackId} · ${sub.buildName}`);
  const hardware = [detectGpus()[0]?.name, cpuName()].filter(Boolean).join(" + ");

  // 1. Compatibility: say "can't verify" instead of failing the tuner.
  const compat = checkCompatible(sub.requires ?? {});
  let report;
  if (!compat.ok) {
    console.log(`  ⚠ not compatible: ${compat.reason}`);
    report = {
      compatible: false, reason: compat.reason, hardware, hashMatches: false, correct: false,
      runs: 0, baselineMedianMs: 0, candidateMedianMs: 0, noisePct: 0, speedup: 0, pass: false,
    };
  } else {
    // 2. The exact code: download it and check its hash ourselves.
    const { ok, data } = await call(`/api/agent/build?code=${code}&sha=${sub.buildSha256}`);
    if (!ok) fail(String(data.detail ?? data.error));
    const files = data.files as Record<string, string>;
    const hashMatches = hashFiles(files) === sub.buildSha256;
    console.log(`  code hash ${hashMatches ? "matches" : "DOES NOT match"} the submission`);

    // Inside the repo, so the build resolves the same packages the baseline uses.
    mkdirSync(path.join(REPO, ".vtec-runs"), { recursive: true });
    const dir = mkdtempSync(path.join(REPO, ".vtec-runs", "verify-"));
    for (const [name, b64] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      writeFileSync(path.join(dir, name), Buffer.from(b64, "base64"));
    }
    const candidateRun = manifestOf(dir).run;
    const baselineDir = path.join(REPO, "tracks", sub.trackId, "baseline");
    const baselineRun = manifestOf(baselineDir).run;
    if (!candidateRun || !baselineRun) fail("Build or baseline has no run command.");

    // 3. Harness: warm-up, then alternate baseline and candidate so drift in
    //    temperature or clocks hits both equally. Every pair gets a fresh
    //    seed, and both must produce the same answer for it.
    const scratch = mkdtempSync(path.join(os.tmpdir(), "vtec-out-"));
    const track = trackConfig(sub.trackId);
    const ext = path.extname(track.output ?? "out.bin");
    const baseOut = path.join(scratch, `baseline${ext}`);
    const candOut = path.join(scratch, `candidate${ext}`);
    console.log(`  warm-up…`);
    runOnce(baselineDir, baselineRun, "0", baseOut);
    runOnce(dir, candidateRun, "0", candOut);
    const base: number[] = [];
    const cand: number[] = [];
    let correct = true;
    for (let i = 0; i < runs; i++) {
      const seed = String(randomBytes(2).readUInt16BE() % 360);
      rmSync(baseOut, { force: true });
      rmSync(candOut, { force: true });
      // Alternate who goes first: the second run of a pair tends to be a bit
      // faster (warm GPU, cached kernels), so a fixed order would favour one side.
      let b, c;
      if (i % 2 === 0) {
        b = runOnce(baselineDir, baselineRun, seed, baseOut);
        c = runOnce(dir, candidateRun, seed, candOut);
      } else {
        c = runOnce(dir, candidateRun, seed, candOut);
        b = runOnce(baselineDir, baselineRun, seed, baseOut);
      }
      base.push(b.ms);
      cand.push(c.ms);
      // The harness checks the output files itself; it never trusts what a build prints.
      const files = !existsSync(baseOut)
        ? true
        : track.compare === "tensor"
          ? sameTensor(baseOut, candOut, track.tolerance ?? 1e-3)
          : false;
      const same = b.sha256 === c.sha256 && files;
      correct &&= same;
      console.log(
        `  run ${i + 1}/${runs}  seed ${seed.padStart(3)}  baseline ${(b.ms / 1000).toFixed(2)} s   candidate ${(c.ms / 1000).toFixed(2)} s   ${same ? "same output" : "DIFFERENT OUTPUT"}`,
      );
    }
    rmSync(dir, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });

    const baselineMedianMs = median(base);
    const candidateMedianMs = median(cand);
    // Noise: how much the baseline disagrees with itself run to run.
    const noisePct = ((Math.max(...base) - Math.min(...base)) / baselineMedianMs) * 100;
    const speedup = baselineMedianMs / candidateMedianMs;
    const gainPct = (speedup - 1) * 100;
    // Faster means clearly faster: at least 3%, more than twice the noise, and
    // even the slowest candidate run beats the fastest baseline run. The same
    // code on both sides can't pass this.
    const separated = Math.max(...cand) < Math.min(...base);
    const pass = hashMatches && correct && gainPct >= 3 && gainPct > 2 * noisePct && separated;

    report = {
      compatible: true, hardware, hashMatches, correct, runs,
      baselineMedianMs: Math.round(baselineMedianMs),
      candidateMedianMs: Math.round(candidateMedianMs),
      noisePct: Math.round(noisePct * 10) / 10,
      speedup: Math.round(speedup * 1000) / 1000,
      pass,
    };
    console.log(`  correct ${correct ? "yes" : "NO"} · speedup ${report.speedup}× · noise ±${report.noisePct}% → ${pass ? "PASS" : "FAIL"}`);
  }

  // 4. Commit now, reveal once every verifier has committed.
  const salt = randomBytes(16).toString("hex");
  const commit = createHash("sha256").update(JSON.stringify(report)).update(salt).digest("hex");
  await post("/api/agent/commit", { code, assignmentId: job.assignmentId, commit });
  mkdirSync(REVEALS, { recursive: true });
  writeFileSync(path.join(REVEALS, `${job.assignmentId}.json`), JSON.stringify({ report, salt }));
  console.log(`  committed. Waiting for the other verifiers to commit…`);
  await revealWhenOpen(job.assignmentId, 10 * 60_000);
}

async function revealWhenOpen(assignmentId: string, timeoutMs: number) {
  const saved = JSON.parse(readFileSync(path.join(REVEALS, `${assignmentId}.json`), "utf8"));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { ok, status, data } = await call("/api/agent/reveal", { code, assignmentId, ...saved });
    if (ok) {
      rmSync(path.join(REVEALS, `${assignmentId}.json`), { force: true });
      console.log(`  ✓ revealed. Submission is now: ${data.submissionStatus}`);
      return;
    }
    if (status !== 425) fail(String(data.detail ?? data.error));
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.log(`  still waiting. Run \`bun agent/vtec-agent.ts reveal ${code}\` later.`);
}

async function verify() {
  if (!code) fail("Usage: vtec-agent verify <CODE> [--runs 5]");
  const runs = Math.max(4, Number(flag("runs") ?? 6));
  const { ok, data } = await call(`/api/agent/assignments?code=${code}`);
  if (!ok) fail(String(data.detail ?? data.error));
  const jobs = (data.jobs as Job[]).filter((j) => j.status === "approved");
  if (jobs.length === 0) {
    const waiting = Number(data.pendingApproval ?? 0);
    console.log(
      waiting > 0
        ? `No approved jobs. ${waiting} assignment(s) need your World ID approval on the Verify page.`
        : "No verification jobs assigned to you right now.",
    );
    return;
  }
  for (const job of jobs) await verifyOne(job, runs);
}

async function reveal() {
  if (!code) fail("Usage: vtec-agent reveal <CODE>");
  if (!existsSync(REVEALS)) return console.log("Nothing to reveal.");
  const pending = readdirSync(REVEALS).filter((f) => f.endsWith(".json"));
  if (pending.length === 0) return console.log("Nothing to reveal.");
  for (const file of pending) await revealWhenOpen(file.replace(/\.json$/, ""), 60_000);
}

if (command === "pair") await pair();
else if (command === "submit") await submit();
else if (command === "verify") await verify();
else if (command === "reveal") await reveal();
else fail("Commands: pair <CODE> | submit <CODE> --track <id> | verify <CODE> | reveal <CODE>");
