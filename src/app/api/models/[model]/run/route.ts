import { findModel, findWorkload } from "@/lib/models";

/**
 * Runs a prompt "on" a model from the catalogue. The answer comes from an
 * OpenAI-compatible endpoint (OpenAI by default), streamed back as
 * server-sent events, with timings measured while it streams:
 *
 *   event: token  data: { text }
 *   event: done   data: { metrics, servedBy }
 *   event: error  data: { error }
 *
 * Env (server only): OPENAI_API_KEY (or LLM_API_KEY), and optionally
 * LLM_BASE_URL (default https://api.openai.com/v1) and LLM_MODEL
 * (default gpt-4o-mini).
 */

const BASE_URL = (process.env.LLM_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
const API_KEY = process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
const MODEL = process.env.LLM_MODEL ?? "gpt-4o-mini";
const MAX_TOKENS = 600;
const MAX_PROMPT = 4000;

export async function POST(request: Request, ctx: RouteContext<"/api/models/[model]/run">) {
  const { model: id } = await ctx.params;
  const model = findModel(id);
  if (!model) return Response.json({ error: "unknown_model" }, { status: 404 });
  if (!API_KEY) {
    return Response.json(
      { error: "not_configured", detail: "Add OPENAI_API_KEY to .env.local and restart the dev server." },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => null)) as { prompt?: string; workload?: string } | null;
  const prompt = body?.prompt?.trim().slice(0, MAX_PROMPT);
  if (!prompt) return Response.json({ error: "missing_prompt" }, { status: 400 });
  const workload = findWorkload(body?.workload ?? "");

  const system = [
    `You are ${model.name} by ${model.vendor} (${model.params}, ${model.quant}), running locally on ${model.hardware}.`,
    workload ? `The user is testing you on ${workload.label}: ${workload.workload}.` : "",
    "Answer directly and concisely. Use Markdown code blocks for code.",
  ]
    .filter(Boolean)
    .join(" ");

  const started = performance.now();
  let upstream: Response;
  try {
    upstream = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: MAX_TOKENS,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    return Response.json({ error: "upstream_unreachable", detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return Response.json({ error: "upstream_error", status: upstream.status, detail: detail.slice(0, 500) }, { status: 502 });
  }

  const encoder = new TextEncoder();
  const send = (controller: ReadableStreamDefaultController, event: string, data: unknown) =>
    controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let firstToken: number | null = null;
      let last = 0;
      const gaps: number[] = [];
      let chars = 0;
      let usage: { prompt_tokens?: number; completion_tokens?: number } | null = null;

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") continue;
            let chunk: {
              choices?: { delta?: { content?: string } }[];
              usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
            };
            try {
              chunk = JSON.parse(payload);
            } catch {
              continue;
            }
            if (chunk.usage) usage = chunk.usage;
            const text = chunk.choices?.[0]?.delta?.content;
            if (!text) continue;
            const now = performance.now();
            if (firstToken === null) firstToken = now;
            else gaps.push(now - last);
            last = now;
            chars += text.length;
            send(controller, "token", { text });
          }
        }

        const end = performance.now();
        const completion = usage?.completion_tokens ?? Math.max(1, Math.round(chars / 4));
        const promptTokens = usage?.prompt_tokens ?? Math.round((system.length + prompt.length) / 4);
        const ttft = (firstToken ?? end) - started;
        const decodeS = Math.max(0.001, (end - (firstToken ?? end)) / 1000);
        const sorted = [...gaps].sort((a, b) => a - b);
        const p99 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] : 0;
        const tps = completion / decodeS;
        send(controller, "done", {
          metrics: {
            ttftMs: Math.round(ttft),
            totalMs: Math.round(end - started),
            promptTokens,
            completionTokens: completion,
            tps: Math.round(tps * 10) / 10,
            prefillTps: Math.round(promptTokens / Math.max(0.001, ttft / 1000)),
            p99GapMs: Math.round(p99 * 10) / 10,
            tpm: Math.round(tps * 60),
          },
          servedBy: { model: MODEL, endpoint: new URL(BASE_URL).host },
        });
      } catch (e) {
        send(controller, "error", { error: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
