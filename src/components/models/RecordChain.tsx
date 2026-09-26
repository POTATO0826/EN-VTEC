"use client";

import * as React from "react";
import { GitCommitHorizontalIcon, QuoteIcon } from "lucide-react";
import { ModelBadge } from "@/components/models/KernelDetail";
import { recordChain, type ChainInput, type Model } from "@/lib/models";
import { shortAddress } from "@/lib/sui-tx";

/**
 * How a board's record was built: one node per kernel that took #1, oldest
 * first, with what it changed in plain words and the verified gain over the
 * record it beat. Big numbers come from stacking small verified steps.
 */
export default function RecordChain({ model, title, rows, currentId }: { model: Model; title: string; rows: ChainInput[]; currentId: string }) {
  const chain = recordChain(rows);
  const record = chain[chain.length - 1] ?? null;
  const first = chain[0] ?? null;
  const others = rows.length - chain.length;
  const biggest = Math.max(0, ...chain.map((n) => n.gainPct ?? 0));

  return (
    <section className="mx-auto mb-16 w-full max-w-6xl">
      <div className="overflow-hidden rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 bg-accent/40 px-5 py-4">
          <h2 className="text-lg font-medium">How the record was built · {title}</h2>
          <div className="flex items-center gap-6">
            <Stat label="Record" value={record ? `${record.speedup.toFixed(2)}×` : "—"} />
            <Stat label="Steps" value={chain.length ? String(chain.length) : "—"} />
            <Stat label="Biggest single step" value={chain.length > 1 ? `+${biggest.toFixed(1)}%` : "—"} />
          </div>
        </div>

        <figure className="m-0 flex gap-3 border-b border-border/60 px-5 py-4 text-sm">
          <QuoteIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div>
            <blockquote className="m-0 text-pretty">
              &ldquo;none of these PRs increase the TG by more than 10%&rdquo;
              <span className="text-muted-foreground"> &mdash; TG is token generation. Stacked together, they took an RTX 4090 from 198 to 271 tokens per second.</span>
            </blockquote>
            <figcaption className="mt-1 text-xs text-muted-foreground">
              A llama.cpp developer, <em>Optimizing Token Generation in llama.cpp&apos;s CUDA Backend</em>. Real speed is built the same way here:
              every time someone takes #1, the chain gets a node saying what changed. Earlier winners keep a 20% share when their work is
              built on.
            </figcaption>
          </div>
        </figure>

        {chain.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">No verified kernel on this board yet. The first one starts the chain.</p>
        ) : (
          <ol className="relative ml-4 border-l border-border/60 py-2 pr-5">
            {chain.map((n, i) => {
              const isRecord = i === chain.length - 1;
              const isCurrent = n.id === currentId;
              return (
                <li key={n.id} className="relative py-5 pl-8">
                  <span
                    className="absolute top-6 -left-[7px] flex size-3.5 items-center justify-center rounded-full border-2 bg-background"
                    style={{ borderColor: isRecord ? "var(--success)" : "var(--info)" }}
                  >
                    {isRecord ? <span className="size-1.5 rounded-full bg-[var(--success)]" /> : null}
                  </span>
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="vtec-num">{new Date(n.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span>
                        <span
                          className="rounded-full border border-border/70 px-2 py-0.5 text-[11px] tracking-[0.08em] uppercase"
                          style={{ color: isRecord ? "var(--success)" : undefined }}
                        >
                          {i === 0 ? "First record" : isRecord ? "Current #1" : `Took #1 · step ${n.step}`}
                        </span>
                        {isCurrent ? <span className="rounded-full bg-accent px-2 py-0.5 text-[11px]">this kernel</span> : null}
                      </div>
                      <div className="mt-1.5 text-sm font-medium">
                        {n.name}
                        <span className="font-normal text-muted-foreground"> · by {n.who ? (n.who.startsWith("0x") ? shortAddress(n.who) : n.who) : "unknown"}</span>
                      </div>
                      <ul className="mt-2 flex flex-col gap-1">
                        {n.changes.map((c) => (
                          <li key={c} className="flex gap-2 text-sm text-foreground/90">
                            <GitCommitHorizontalIcon className="mt-0.5 size-3.5 shrink-0 text-[var(--info)]" />
                            <span className="text-pretty">{c}</span>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <ModelBadge model={model} />
                        {n.prevSpeedup != null ? (
                          <span>builds on the {n.prevSpeedup.toFixed(2)}× record · that tuner earns 20% of each license of this one</span>
                        ) : (
                          <span>the first verified kernel on this board</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="vtec-num text-2xl leading-none" style={{ color: isRecord ? "var(--success)" : undefined }}>
                        {n.speedup.toFixed(2)}×
                      </div>
                      <div className="vtec-num mt-1 text-xs text-muted-foreground">
                        {n.gainPct != null ? `+${n.gainPct.toFixed(1)}% on the record` : "vs the baseline"}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        <p className="micro border-t border-border/60 px-5 py-3">
          {first && record && chain.length > 1
            ? `${chain.length} record-setting steps took this board from ${first.speedup.toFixed(2)}× to ${record.speedup.toFixed(2)}×. `
            : ""}
          {others > 0
            ? `${others} other verified kernel${others === 1 ? "" : "s"} on this board didn't beat the record when ${others === 1 ? "it" : "they"} landed. `
            : ""}
          {rows.some((r) => r.sample) ? "Sample data." : "From real submissions on this platform."}
        </p>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <div className="text-[10px] tracking-[0.18em] text-muted-foreground uppercase">{label}</div>
      <div className="vtec-num text-lg">{value}</div>
    </div>
  );
}
