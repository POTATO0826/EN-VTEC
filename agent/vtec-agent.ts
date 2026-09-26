#!/usr/bin/env bun
/**
 * VTEC local agent.
 *
 *   bun agent/vtec-agent.ts pair <CODE>
 *       Reads this machine's GPU/CPU and pairs with the browser session that
 *       showed <CODE> on the Get started page.
 *
 *   bun agent/vtec-agent.ts submit <CODE> --track <id> [--build <dir>] [--run "<command>"]
 *       Hashes the build (SHA-256), runs it, hashes its output, and submits.
 *       --build defaults to tracks/<id>/baseline. --run defaults to the "run"
 *       command in the build's vtec.json. Needs a World ID approval first.
 *
 * Options: --url <app url>  (default http://127.0.0.1:3000, or VTEC_URL)
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const [command, code] = args;

function flag(name: string) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

const URL_BASE = (flag("url") ?? process.env.VTEC_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

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
      [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name + '|' + $_.DriverVersion }",
      ],
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

async function post(route: string, body: unknown) {
  let res: Response;
  try {
    res = await fetch(`${URL_BASE}${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    fail(`Can't reach ${URL_BASE}. Is the app running?`);
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, string>;
  if (!res.ok) fail(data.detail ?? data.error ?? `HTTP ${res.status}`);
  return data;
}

/** SHA-256 over every file in the build, in a fixed order, with its path. */
function hashDir(dir: string) {
  const hash = createHash("sha256");
  const walk = (current: string) => {
    for (const entry of readdirSync(current).sort()) {
      if (entry === "node_modules" || entry === ".git") continue;
      const full = path.join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else {
        hash.update(path.relative(dir, full).replaceAll("\\", "/"));
        hash.update(readFileSync(full));
      }
    }
  };
  walk(dir);
  return hash.digest("hex");
}

async function pair() {
  if (!code) fail("Usage: vtec-agent pair <CODE>");
  const gpus = detectGpus();
  const info = {
    code,
    hostname: os.hostname(),
    os: `${os.type()} ${os.release()}`,
    cpu: os.cpus()[0]?.model.trim() ?? "unknown CPU",
    gpus,
  };
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
  if (!code || !track) fail("Usage: vtec-agent submit <CODE> --track <id> [--build <dir>] [--run \"<command>\"]");

  // Default build: the track's baseline, shipped in this repo.
  const repo = path.resolve(import.meta.dir, "..");
  const build = flag("build") ?? path.join(repo, "tracks", track, "baseline");
  if (!existsSync(build)) fail(`Build folder not found: ${build}`);

  // Default command: whatever the build says in its vtec.json.
  let run = flag("run");
  const manifest = path.join(build, "vtec.json");
  if (!run && existsSync(manifest)) {
    const meta = JSON.parse(readFileSync(manifest, "utf8")) as { name?: string; run?: string };
    run = meta.run;
    if (meta.name) console.log(`• build  ${meta.name}`);
  }
  if (!run) fail(`No --run given and no "run" in ${manifest}`);

  const buildSha256 = hashDir(path.resolve(build));
  console.log(`• build  sha256 ${buildSha256}`);

  const started = performance.now();
  const result = spawnSync(run, { shell: true, cwd: path.resolve(build), encoding: "buffer" });
  const seconds = (performance.now() - started) / 1000;
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    fail(`Benchmark failed (exit ${result.status}).`);
  }

  const resultSha256 = createHash("sha256").update(result.stdout).digest("hex");
  console.log(`• result sha256 ${resultSha256}`);
  console.log(`• time   ${seconds.toFixed(3)} s`);

  const data = await post("/api/agent/submit", { code, trackId: track, buildSha256, resultSha256, seconds });
  console.log(`✓ Submitted (${data.id})`);
}

if (command === "pair") await pair();
else if (command === "submit") await submit();
else fail("Commands: pair <CODE> | submit <CODE> --track <id> --build <dir> --run \"<command>\"");
