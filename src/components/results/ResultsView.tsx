"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { times, type ResultEntry } from "@/lib/results";
import { SAMPLE_ENTRIES } from "@/lib/results-sample";
import { useSessionId } from "@/lib/session";
import Evidence from "./Evidence";
import SkillChart from "./SkillChart";
import { STATUS } from "./status";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "orb-field": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
      "accretion-disc": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { motion?: string };
    }
  }
}

const clock = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** The signed-in session's results, polled like the rest of the app. */
function useEntries(sessionId: string | null, include: string | null, sample: boolean) {
  const [entries, setEntries] = React.useState<ResultEntry[] | null>(sample ? SAMPLE_ENTRIES : null);
  const [updatedAt, setUpdatedAt] = React.useState("");
  React.useEffect(() => {
    if (sample || !sessionId) return;
    let alive = true;
    const load = async () => {
      const qs = new URLSearchParams({ session: sessionId, ...(include ? { id: include } : {}) });
      const res = await fetch(`/api/results?${qs}`, { cache: "no-store" });
      if (res.ok && alive) {
        setEntries((await res.json()).entries);
        setUpdatedAt(clock());
      }
    };
    load();
    const timer = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [sessionId, include, sample]);
  return { entries, updatedAt };
}

function useNarrow() {
  const [narrow, setNarrow] = React.useState(false);
  React.useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 900);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return narrow;
}

export default function ResultsView({ initialId, sample }: { initialId: string | null; sample: boolean }) {
  const sessionId = useSessionId();
  const { entries, updatedAt } = useEntries(sessionId, initialId, sample);
  const narrow = useNarrow();
  const [sel, setSel] = React.useState<string | null>(initialId);
  const [hover, setHover] = React.useState<string | null>(null);
  const entry = entries?.find((e) => e.id === sel) ?? null;
  const missing = !!sel && !!entries && !entry;

  // The constellation is two web components; they register themselves on import.
  React.useEffect(() => {
    import("./accretion-disc");
    import("./orb-field");
  }, []);

  // Selection lives in the URL, so a result can be linked to and shared.
  const select = React.useCallback(
    (id: string | null) => {
      setSel(id);
      window.history.replaceState(null, "", `/results${id ? `/${id}` : ""}${sample ? "?sample=1" : ""}`);
    },
    [sample],
  );

  const orbs = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    const el = orbs.current;
    if (!el) return;
    const onSelect = (e: Event) => select((e as CustomEvent<{ id: string }>).detail.id);
    const onHover = (e: Event) => setHover((e as CustomEvent<{ id: string | null }>).detail.id);
    el.addEventListener("orb-select", onSelect);
    el.addEventListener("orb-hover", onHover);
    return () => {
      el.removeEventListener("orb-select", onSelect);
      el.removeEventListener("orb-hover", onHover);
    };
  }, [select]);

  // ↑ ↓ step through results, Esc goes back to all of them.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "Escape") return select(null);
      if ((e.key !== "ArrowDown" && e.key !== "ArrowUp") || !entries?.length) return;
      const i = entries.findIndex((x) => x.id === sel);
      const next = i < 0 ? 0 : (i + (e.key === "ArrowDown" ? 1 : entries.length - 1)) % entries.length;
      e.preventDefault();
      select(entries[next].id);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [entries, sel, select]);

  const domains = JSON.stringify((entries ?? []).map((e) => ({ id: e.id, label: e.label, color: STATUS[e.detail.status][0] })));
  const [statusColor, statusLabel] = entry ? STATUS[entry.detail.status] : ["", ""];
  const d = entry?.detail;
  const ran = d?.verifiers.filter((v) => v.reported).length ?? 0;

  return (
    <div data-full-bleed className="min-h-[calc(100vh-4rem)] text-[15px] leading-normal">
      <section className="relative border-b border-border/60">
        <div
          className="relative overflow-hidden"
          style={{ height: narrow ? "clamp(420px, 58vh, 640px)" : "clamp(560px, calc(100vh - 4rem), 920px)" }}
        >
          <div className="absolute inset-0 transition-opacity duration-500" style={{ opacity: entry ? 0.35 : 0.5 }}>
            <accretion-disc style={{ position: "absolute", inset: 0 }} />
          </div>
          <orb-field
            ref={orbs}
            style={{ position: "absolute", inset: 0 }}
            data-domains={domains}
            data-selected={entry?.id ?? ""}
            data-focus-x={narrow ? "0" : "-0.5"}
            data-spin="-0.12"
          />

          <div
            className="pointer-events-none absolute top-6 left-4 max-w-[380px] transition-opacity duration-400 md:left-8"
            style={{ opacity: entry ? 0 : 1 }}
          >
            <h6 className="m-0 mb-3 text-xs tracking-[0.18em] text-muted-foreground uppercase">
              Kernel verification · {sample ? "sample data" : "your submissions"}
            </h6>
            <h1 className="m-0 mb-3.5 font-display text-[40px] leading-[1.05] font-extrabold tracking-[-0.02em] text-pretty">
              Your kernels, verified.
            </h1>
            <p className="m-0 mb-4.5 text-[15px] text-pretty text-muted-foreground">
              Each orb is a kernel your agent submitted. Select one to open its skill chart and the full evidence chain, with
              on-chain receipts.
            </p>
            <div className="flex gap-4.5 text-[11px] tracking-[0.08em] text-muted-foreground uppercase">
              {(["verified", "verifying", "rejected"] as const).map((s) => (
                <span key={s} className="inline-flex items-center gap-1.5">
                  <span className="size-2 rounded-full" style={{ background: STATUS[s][0] }} />
                  {s === "verifying" ? "Pending" : STATUS[s][1]}
                </span>
              ))}
            </div>
          </div>

          {!sample && !entry ? (
            <div className="micro pointer-events-none absolute top-6 right-4 inline-flex items-center gap-2 tracking-[0.08em] uppercase md:right-8">
              <span className="online-dot animate-pulse motion-reduce:animate-none" /> Live · /api/results every 3 s
              {updatedAt ? <span className="vtec-num normal-case">{updatedAt}</span> : null}
            </div>
          ) : null}
        </div>

        {entry && d ? (
          <aside
            className={
              narrow
                ? "relative z-[2] flex w-full flex-col gap-5 border-t border-border/60 bg-card/60 px-4 pt-6 pb-8 backdrop-blur-sm"
                : "absolute top-0 right-0 z-[2] flex h-full w-[min(46%,560px)] flex-col gap-5 overflow-y-auto border-l border-border/60 bg-card/60 px-7 pt-6 pb-8 backdrop-blur-sm"
            }
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h6 className="m-0 mb-1.5 text-xs tracking-[0.18em] text-muted-foreground uppercase">
                  {entry.label} · {entry.workload}
                </h6>
                <h3 className="m-0 mb-2.5 font-display text-xl leading-[1.15] font-extrabold tracking-[-0.015em] text-pretty">
                  {entry.kernel.name}
                </h3>
                <div className="flex flex-wrap items-center gap-2.5 text-xs text-muted-foreground">
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full border border-border/70 px-2 py-0.5 text-xs"
                    style={{ color: statusColor }}
                  >
                    <span className="size-1.5 rounded-full" style={{ background: statusColor }} />
                    {statusLabel}
                  </span>
                  <span>{d.draw ? `verified by ${ran}/${d.verifiers.length}` : "awaiting verifier draw"}</span>
                  <span>
                    {entry.kernel.rank
                      ? `rank #${entry.kernel.rank} of ${entry.kernel.of}`
                      : `unranked · ${entry.kernel.of} on this board`}
                  </span>
                </div>
              </div>
              <Button variant="outline" className="flex-none rounded-full" onClick={() => select(null)}>
                <ArrowLeftIcon /> All results
              </Button>
            </div>
            <SkillChart entry={entry} sample={sample} />
          </aside>
        ) : null}
      </section>

      {entry ? (
        <Evidence key={entry.id} entry={entry} sample={sample} />
      ) : (
        <section className="mx-auto w-full max-w-6xl px-4 pt-7 pb-12 md:px-8">
          {missing ? (
            <p className="mb-5 border-l-2 border-[var(--warning)] pl-3 text-sm text-muted-foreground">
              That result wasn&apos;t found. It may belong to another track that no longer exists, or the link is wrong.
            </p>
          ) : null}
          <List entries={entries} hover={hover} onSelect={select} sample={sample} />
        </section>
      )}
    </div>
  );
}

const ROW = "grid grid-cols-[14px_minmax(0,2fr)_minmax(0,3fr)_110px_90px_70px_20px] items-center gap-4 max-md:grid-cols-[14px_minmax(0,1fr)_90px_20px]";

function List({
  entries,
  hover,
  onSelect,
  sample,
}: {
  entries: ResultEntry[] | null;
  hover: string | null;
  onSelect: (id: string) => void;
  sample: boolean;
}) {
  if (entries && entries.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 bg-card/40 p-8">
        <h3 className="m-0 mb-2 text-xl font-medium">No submissions yet.</h3>
        <p className="m-0 mb-5 max-w-[60ch] text-sm text-muted-foreground">
          Submit a kernel from a track. It shows up here as soon as your agent uploads it, and fills in while the harness
          and verifiers re-run it.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild className="rounded-full px-5">
            <Link href="/tuners">
              Go to the tracks <ArrowRightIcon />
            </Link>
          </Button>
          <Button asChild variant="outline" className="rounded-full">
            <Link href="/results?sample=1">Preview with sample data</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card/60 px-4 pt-3 pb-4 backdrop-blur-sm">
      <div className={`${ROW} border-b border-border pb-2.5 text-[11px] tracking-[0.08em] text-muted-foreground uppercase`}>
        <span />
        <span>Kernel</span>
        <span className="max-md:hidden">Build</span>
        <span className="max-md:hidden">Status</span>
        <span>Speedup</span>
        <span className="max-md:hidden">Rank</span>
        <span />
      </div>
      {entries === null
        ? [0, 1, 2].map((i) => <div key={i} className="h-[53px] animate-pulse border-b border-border/60 bg-muted/30" />)
        : entries.map((e) => {
            const [color, status] = STATUS[e.detail.status];
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => onSelect(e.id)}
                className={`${ROW} w-full border-0 border-b border-border/60 py-3.5 text-left text-foreground transition-colors hover:bg-accent/50 ${hover === e.id ? "bg-accent/50" : "bg-transparent"}`}
              >
                <span className="size-2.5 rounded-full" style={{ background: color }} />
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-medium">{e.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{e.workload}</span>
                </span>
                <span className="truncate text-[13px] text-muted-foreground max-md:hidden">{e.kernel.name}</span>
                <span className="text-xs max-md:hidden" style={{ color }}>
                  {status}
                </span>
                <span className="vtec-num text-sm">{e.detail.outcome?.speedup != null ? times(e.detail.outcome.speedup) : "—"}</span>
                <span className="vtec-num text-[13px] text-muted-foreground max-md:hidden">
                  {e.kernel.rank ? `#${e.kernel.rank} / ${e.kernel.of}` : "unranked"}
                </span>
                <ArrowRightIcon className="size-4 text-muted-foreground" />
              </button>
            );
          })}
      <p className="micro mt-3.5">
        ↑ ↓ to move between results · Esc to return here ·{" "}
        {sample ? (
          <>
            Sample data · <Link href="/results" className="text-foreground underline-offset-4 hover:underline">show my submissions</Link>
          </>
        ) : (
          <>
            Your 10 most recent submissions ·{" "}
            <Link href="/results?sample=1" className="text-foreground underline-offset-4 hover:underline">preview with sample data</Link>
          </>
        )}
      </p>
    </div>
  );
}
