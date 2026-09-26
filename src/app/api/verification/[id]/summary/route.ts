import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { complete, LlmError } from "@/lib/server/llm";
import { load } from "@/lib/server/store";
import { verificationStory, type VerificationStory } from "@/lib/server/verification-story";

/**
 * An agent's analysis of how a submission was verified: how it was tuned,
 * how it was tested, how it performed, what happens next. Written from the
 * same record the page shows and nothing else; the arithmetic is done here,
 * not by the model. Cached per state of the record (?refresh=1 forces a new one).
 */

const CACHE = path.join(process.cwd(), ".data", "summaries.json");
/** Bump when the prompt or the sections change, so old analyses are rewritten. */
const PROMPT_VERSION = "v3";

/** Short, plain bullets: the verdict and caveat are one line each, the rest are lists. */
export type Analysis = { verdict: string; tuning: string[]; testing: string[]; performance: string[]; next: string[]; caveat: string };
const LISTS = ["tuning", "testing", "performance", "next"] as const;
type Cached = { key: string; analysis: Analysis; model: string; at: string };

async function readCache(): Promise<Record<string, Cached>> {
  try {
    return existsSync(CACHE) ? JSON.parse(await readFile(CACHE, "utf8")) : {};
  } catch {
    return {};
  }
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const r2 = (v: number) => Math.round(v * 100) / 100;

/** What the agent is allowed to know: the record, hashes cut short, performance precomputed. */
function factsOf(s: VerificationStory) {
  const short = (h: string) => `${h.slice(0, 12)}…`;
  const best = s.tuneLog?.map((l) => l.match(/best: (.+?), ([\d.]+)×/)).find(Boolean);
  const tried = s.tuneLog?.map((l) => l.match(/(\d+) of (\d+) variants/)).find(Boolean);
  return {
    kernel: s.buildName,
    track: s.track,
    status: s.status,
    verifiedSpeedup: s.speedup ? `${s.speedup}×` : null,
    tuning: s.tuneLog
      ? {
          gpu: s.gpu,
          variantsTried: tried ? `${tried[1]} of ${tried[2]}` : null,
          winner: best?.[1] ?? null,
          tunersOwnSpeedup: best ? `${best[2]}×` : null,
          printedLines: s.tuneLog.map((l) => l.replace(/[0-9a-f]{64}/g, (h) => short(h))),
        }
      : "no auto-tune run on record: the build was submitted as written",
    tunerRunSeconds: s.seconds,
    code: short(s.buildSha256),
    worldIdApproved: !!s.approval?.worldId,
    feePaidSui: s.approval?.fee?.amountSui ?? null,
    verifierDraw: s.draw ? (s.draw.source === "server" ? "server randomness" : "Sui on-chain randomness") : "not drawn yet",
    platformHarnessStoodIn: s.harness,
    verifiersRequiredToAgree: s.quorum,
    outputTolerance: s.tolerance,
    verifiers: s.verifiers.map((v) => ({
      who: v.who,
      hardware: v.hardware,
      state: v.source === "running" ? "still running" : v.pass ? "passed" : "failed",
      howItTested: "downloaded the exact files and checked their hash; one warm-up run excluded from timing; then baseline and build timed in pairs, a fresh random seed per pair, alternating which ran first; outputs compared by the verifier itself",
      performance: v.runs
        ? {
            timedRuns: v.runs.cand.length,
            baselineMedianSeconds: r2(median(v.runs.base)),
            buildMedianSeconds: r2(median(v.runs.cand)),
            baselineRangeSeconds: `${r2(Math.min(...v.runs.base))}–${r2(Math.max(...v.runs.base))}`,
            buildRangeSeconds: `${r2(Math.min(...v.runs.cand))}–${r2(Math.max(...v.runs.cand))}`,
            timeSavedPerRunSeconds: r2(median(v.runs.base) - median(v.runs.cand)),
            speedup: v.speedup ? `${v.speedup}×` : null,
            fasterByPercent: v.speedup ? Math.round((v.speedup - 1) * 1000) / 10 : null,
            runToRunNoisePercent: v.noisePct,
          }
        : null,
      passRule: v.checks.map((c) => `${c.ok ? "OK" : "FAILED"} ${c.label}: ${c.detail}`),
    })),
    feeSplitBetween: s.feeSettlement?.recipients ?? null,
    listedForLicensingOnSui: !!s.listing,
  };
}

const SYSTEM = `You are the verification analyst for Opti-om. An agent tunes a GPU kernel on the tuner's laptop; independent verifiers re-run it before anyone can buy it.
Explain one submission to a non-expert, using ONLY the facts given. Never invent numbers or steps; copy numbers exactly, with units (× speedups, s seconds, % percentages). Do no arithmetic.
Write short, simple bullets: each at most 12 words, everyday words, no jargon (say "random inputs", not "seeds"; "same result", not "within tolerance").
Reply with one JSON object:
"verdict": string, at most 12 words, e.g. "Verified: 2.42× faster than the standard kernel."
"tuning": array of 1-2 bullets: how the agent tuned it.
"testing": array of 2-3 bullets: how the verifier tested it.
"performance": array of 2-3 bullets: before vs after times, and why that is clearly faster (or not).
"next": array of 1 bullet: fee and listing.
"caveat": string, at most 14 words, if something limits confidence, otherwise "".
No markdown, no bullet characters inside the strings.`;

export async function GET(request: Request, ctx: RouteContext<"/api/verification/[id]/summary">) {
  const { id } = await ctx.params;
  const url = new URL(request.url);
  const story = verificationStory(await load(), id, url.searchParams.get("session"));
  if (!story) return Response.json({ error: "not_found" }, { status: 404 });

  const facts = factsOf(story);
  const key = createHash("sha256").update(PROMPT_VERSION).update(JSON.stringify(facts)).digest("hex").slice(0, 16);
  const cache = await readCache();
  const hit = cache[id];
  if (hit?.analysis && hit.key === key && url.searchParams.get("refresh") !== "1") return Response.json({ ...hit, cached: true });

  try {
    const { text, model } = await complete({
      system: SYSTEM,
      user: `Facts about submission ${id}:\n${JSON.stringify(facts, null, 2)}`,
      maxTokens: 600,
      json: true,
    });
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new LlmError("The model's analysis wasn't valid JSON; try Regenerate.");
    }
    const text1 = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const list = (v: unknown) => (Array.isArray(v) ? v : typeof v === "string" ? [v] : []).map(text1).filter(Boolean).slice(0, 3);
    const analysis = {
      verdict: text1(parsed.verdict),
      caveat: text1(parsed.caveat),
      ...Object.fromEntries(LISTS.map((k) => [k, list(parsed[k])])),
    } as Analysis;
    if (!analysis.verdict) throw new LlmError("The model's analysis came back without a verdict; try Regenerate.");
    const entry: Cached = { key, analysis, model, at: new Date().toISOString() };
    cache[id] = entry;
    await mkdir(path.dirname(CACHE), { recursive: true });
    await writeFile(CACHE, JSON.stringify(cache, null, 2));
    return Response.json({ ...entry, cached: false });
  } catch (e) {
    const status = e instanceof LlmError ? e.status : 500;
    return Response.json({ error: "summary_failed", detail: e instanceof Error ? e.message : String(e) }, { status });
  }
}
