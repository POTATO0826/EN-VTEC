/**
 * Formatting helpers. These exist so the copy rules are enforced in one place
 * rather than remembered at every call site:
 *
 *   - job sizes are always real numbers, never "small" or "large"
 *   - a variant is always its letter AND its plain name
 *   - a speedup never appears without the noise band it has to clear
 */

const NUM = new Intl.NumberFormat("en-US");

/** 262144 -> "262,144" */
export function num(n: number): string {
  return NUM.format(n);
}

/** 262144 -> "262,144 messages" */
export function messages(n: number): string {
  return `${NUM.format(n)} messages`;
}

/** 262144 -> "job: 262,144 messages" */
export function jobLabel(n: number): string {
  return `job: ${NUM.format(n)} messages`;
}

/** 12.43 -> "12.4 ms" */
export function ms(n: number): string {
  return `${n.toFixed(n < 10 ? 2 : 1)} ms`;
}

/** 2.2 -> "2.20x" (rendered with a real multiplication sign) */
export function speedup(n: number): string {
  return `${n.toFixed(2)}×`;
}

/** 3.1 -> "3.1%" */
export function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}

/** 4096 -> "4 KB" */
export function bytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(0)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} bytes`;
}

/** 16384 (MB) -> "16 GB" */
export function vram(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB` : `${mb} MB`;
}

/** 4398046511104 bytes of working set -> "4.3 GB" */
export function gigabytes(bytesValue: number): string {
  return `${(bytesValue / 1024 ** 3).toFixed(1)} GB`;
}

/** 0x1f2e... -> "0x1f2e3a4b...9c2d" */
export function shortHash(hash: string, lead = 10, tail = 6): string {
  if (hash.length <= lead + tail + 3) return hash;
  return `${hash.slice(0, lead)}…${hash.slice(-tail)}`;
}

/** "2026-09-17" -> "17 Sep 2026" */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Speedup and the band it had to clear, never one without the other. */
export function speedupWithBand(value: number, noiseBand: number): string {
  return `${speedup(value)} baseline · noise band ${pct(noiseBand)}`;
}

/** The full measurement line: "12.4 ms - 2.20x baseline - noise band 3.1%" */
export function measurementLine(
  medianMs: number,
  value: number,
  noiseBand: number,
): string {
  return `${ms(medianMs)} · ${speedupWithBand(value, noiseBand)}`;
}
