/**
 * Video render — NVENC build (RTX GPU encoder). Same output spec as the
 * baseline; the only change is encoding on the GPU instead of the CPU.
 *
 * Renders the track's reference clip: 2 minutes, 1920×1080, 30 fps, H.264,
 * from ffmpeg's built-in test pattern. VTEC_SEED shifts the hue, so a build
 * can't hand in a pre-rendered file; it must write to VTEC_OUT, which the
 * verifier's harness inspects itself (frames, codec, and what it looks like).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const seed = Number(process.env.VTEC_SEED ?? 0) % 360;
const out = process.env.VTEC_OUT ?? path.join(mkdtempSync(path.join(tmpdir(), "vtec-render-")), "out.mp4");

const render = spawnSync(
  "ffmpeg",
  [
    "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30:duration=120",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=120",
    "-vf", `hue=h=${seed}`,
    "-c:v", "h264_nvenc", "-preset", "p4", "-pix_fmt", "yuv420p",
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
if (probe.status !== 0) process.exit(probe.status ?? 1);

// e.g. "h264,1920,1080,30/1,3600"
console.log(probe.stdout.trim());
