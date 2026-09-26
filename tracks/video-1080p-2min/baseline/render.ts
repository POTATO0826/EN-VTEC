/**
 * Video render — baseline build (CPU, libx264).
 *
 * Renders the track's reference clip: 2 minutes, 1920×1080, 30 fps, H.264,
 * from ffmpeg's built-in test pattern so every machine renders the same input.
 * Prints one line describing the output. Any correct build prints the same
 * line, so its SHA-256 is the correctness check; the agent times the run.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "vtec-render-"));
const out = path.join(dir, "out.mp4");

const render = spawnSync(
  "ffmpeg",
  [
    "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30:duration=120",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=120",
    "-c:v", "libx264", "-preset", "medium", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-shortest",
    out,
  ],
  { stdio: ["ignore", "ignore", "inherit"] },
);
if (render.status !== 0) process.exit(render.status ?? 1);

const probe = spawnSync(
  "ffprobe",
  [
    "-v", "error", "-select_streams", "v:0", "-count_packets",
    "-show_entries", "stream=codec_name,width,height,r_frame_rate,nb_read_packets",
    "-of", "csv=p=0", out,
  ],
  { encoding: "utf8" },
);
rmSync(dir, { recursive: true, force: true });
if (probe.status !== 0) process.exit(probe.status ?? 1);

// e.g. "h264,1920,1080,30/1,3600"
console.log(probe.stdout.trim());
