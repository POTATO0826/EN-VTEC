"use client";

import * as React from "react";
import { PlayIcon, SquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Model, WorkloadId } from "@/lib/models";

type Metrics = {
  ttftMs: number;
  totalMs: number;
  promptTokens: number;
  completionTokens: number;
  tps: number;
  prefillTps: number;
  p99GapMs: number;
  tpm: number;
};

/** A starting prompt per workload, so a run is one click in a demo. */
const PRESETS: Record<WorkloadId, string> = {
  inference: "In three sentences, explain what a KV cache is and why paged attention helps long conversations.",
  coding: "Write a CUDA kernel for RMSNorm over rows of 4096 floats: one block per row, warp-shuffle reduction, float4 loads.",
  imagegen: "Describe, step by step, how a Winograd F(4,3) transform speeds up a 3×3 convolution in a diffusion UNet.",
  video: "Summarise how motion estimation with a 16×16 SAD search works in a video encoder, and where a GPU helps.",
  render: "Explain the Möller–Trumbore ray–triangle test and how to keep a GPU warp coherent while running it.",
  science: "Give a short plan for a GPU sparse matrix–vector multiply on a CSR matrix with very uneven row lengths.",
};

/** Run a prompt on the selected model and workload; tokens stream in, timings land at the end. */
export default function RunPanel({ model, workloadId }: { model: Model; workloadId: WorkloadId }) {
  const [prompt, setPrompt] = React.useState(PRESETS[workloadId]);
  const [output, setOutput] = React.useState("");
  const [metrics, setMetrics] = React.useState<Metrics | null>(null);
  const [servedBy, setServedBy] = React.useState<{ model: string; endpoint: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [running, setRunning] = React.useState(false);
  const abort = React.useRef<AbortController | null>(null);

  // A new workload starts from its own preset.
  const [forWorkload, setForWorkload] = React.useState(workloadId);
  if (forWorkload !== workloadId) {
    setForWorkload(workloadId);
    setPrompt(PRESETS[workloadId]);
    setOutput("");
    setMetrics(null);
    setError(null);
  }

  React.useEffect(() => () => abort.current?.abort(), []);

  const run = async () => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setRunning(true);
    setOutput("");
    setMetrics(null);
    setError(null);
    try {
      const res = await fetch(`/api/models/${model.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, workload: workloadId }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail ?? data.error ?? `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let split: number;
        while ((split = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          const event = block.match(/^event: (.+)$/m)?.[1];
          const data = block.match(/^data: (.+)$/m)?.[1];
          if (!event || !data) continue;
          const payload = JSON.parse(data);
          if (event === "token") setOutput((o) => o + payload.text);
          else if (event === "done") {
            setMetrics(payload.metrics);
            setServedBy(payload.servedBy);
          } else if (event === "error") throw new Error(payload.error);
        }
      }
    } catch (e) {
      if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (abort.current === ctrl) setRunning(false);
    }
  };

  const stop = () => {
    abort.current?.abort();
    setRunning(false);
  };

  const stats: [string, string][] = metrics
    ? [
        ["Decode", `${metrics.tps} tok/s`],
        ["First token", `${metrics.ttftMs} ms`],
        ["Prefill", `${metrics.prefillTps} tok/s`],
        ["p99 gap", `${metrics.p99GapMs} ms`],
        ["Tokens", `${metrics.promptTokens} in · ${metrics.completionTokens} out`],
        ["Total", `${(metrics.totalMs / 1000).toFixed(2)} s`],
      ]
    : [];

  return (
    <div className="border-t border-border pt-3">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h6 className="m-0 font-display text-[11px] font-extrabold tracking-[0.1em] uppercase">Run it on {model.name}</h6>
        {running ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="online-dot animate-pulse motion-reduce:animate-none" /> streaming
          </span>
        ) : null}
      </div>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={3}
        className="w-full resize-y rounded-lg border border-border/70 bg-black/30 px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring"
      />
      <div className="mt-2 flex items-center gap-2">
        {running ? (
          <Button variant="outline" className="rounded-full" onClick={stop}>
            <SquareIcon /> Stop
          </Button>
        ) : (
          <Button className="rounded-full px-5" onClick={run} disabled={!prompt.trim()}>
            <PlayIcon /> Run
          </Button>
        )}
      </div>

      {error ? <p className="mt-3 text-sm text-[var(--danger)]">{error}</p> : null}

      {output || running ? (
        <pre className="mt-3 max-h-72 overflow-auto rounded-lg border border-border/60 bg-black/40 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground/90">
          {output}
          {running ? <span className="animate-pulse">▍</span> : null}
        </pre>
      ) : null}

      {metrics ? (
        <>
          <dl className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-border/60 bg-border/60 text-xs">
            {stats.map(([k, v]) => (
              <div key={k} className="bg-card/80 px-3 py-2">
                <dt className="text-[10px] tracking-[0.12em] text-muted-foreground uppercase">{k}</dt>
                <dd className="vtec-num mt-0.5">{v}</dd>
              </div>
            ))}
          </dl>
          {servedBy ? (
            <p className="micro mt-2">
              Served by {servedBy.model} via {servedBy.endpoint}.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
