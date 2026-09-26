"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon, ShoppingCartIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import GetKernelDialog, { type Purchasable } from "@/components/models/GetKernel";
import SkillChart from "@/components/results/SkillChart";
import { STATUS } from "@/components/results/status";
import { modelEntry, sampleKernels, WORKLOADS, type KernelRow, type Model, type WorkloadId } from "@/lib/models";
import { shortAddress, SUI } from "@/lib/sui-tx";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "orb-field": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
      "accretion-disc": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { motion?: string };
    }
  }
}

// Each orb is a workload; its colour is the verdict on the best kernel submitted for it.
const LEGEND: [status: "verified" | "verifying" | "rejected", title: string, meaning: string][] = [
  ["verified", "Verified", "Verifiers re-ran it: same output, clearly faster. On the ranking, can be licensed."],
  ["verifying", "Pending", "No verdict yet: no kernel submitted, or verifiers are still re-running it."],
  ["rejected", "Rejected", "Tested, but not proven faster (or a different output). Off the ranking."],
];

/** Kernels verified on this platform for the model, polled like the rest of the app. */
function useRealRows(modelId: string) {
  const [rows, setRows] = React.useState<KernelRow[]>([]);
  React.useEffect(() => {
    let alive = true;
    const load = async () => {
      const res = await fetch(`/api/models/${modelId}`, { cache: "no-store" });
      if (res.ok && alive) setRows((await res.json()).rows);
    };
    load();
    const timer = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [modelId]);
  return rows;
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

/**
 * One model × workload board, ranked by speedup. A workload with a real track
 * shows only kernels verified on this platform; the others show sample rows.
 */
export function boardOf(model: Model, workloadId: WorkloadId, real: KernelRow[]) {
  const rows = model.tracks[workloadId] ? real.filter((r) => r.workloadId === workloadId) : sampleKernels(model, workloadId);
  return rows.sort((a, b) => {
    const av = a.status === "verified" ? a.speedup : -1;
    const bv = b.status === "verified" ? b.speedup : -1;
    return bv - av;
  });
}

export default function ModelView({ model, initialWorkload }: { model: Model; initialWorkload: string | null }) {
  const router = useRouter();
  const real = useRealRows(model.id);
  const narrow = useNarrow();
  const [sel, setSel] = React.useState<WorkloadId | null>(initialWorkload as WorkloadId | null);
  const [hover, setHover] = React.useState<string | null>(null);
  const [buying, setBuying] = React.useState<Purchasable | null>(null);

  const entries = React.useMemo(() => WORKLOADS.map((w) => modelEntry(model, w.id)), [model]);
  const entry = entries.find((e) => e.id === sel) ?? null;

  React.useEffect(() => {
    import("@/components/results/accretion-disc");
    import("@/components/results/orb-field");
  }, []);

  const select = React.useCallback(
    (id: WorkloadId | null) => {
      setSel(id);
      window.history.replaceState(null, "", `/models/${model.id}${id ? `?workload=${id}` : ""}`);
    },
    [model.id],
  );

  const orbs = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    const el = orbs.current;
    if (!el) return;
    const onSelect = (e: Event) => select((e as CustomEvent<{ id: WorkloadId }>).detail.id);
    const onHover = (e: Event) => setHover((e as CustomEvent<{ id: string | null }>).detail.id);
    el.addEventListener("orb-select", onSelect);
    el.addEventListener("orb-hover", onHover);
    return () => {
      el.removeEventListener("orb-select", onSelect);
      el.removeEventListener("orb-hover", onHover);
    };
  }, [select]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "Escape") return select(null);
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const i = WORKLOADS.findIndex((w) => w.id === sel);
      const next = i < 0 ? 0 : (i + (e.key === "ArrowDown" ? 1 : WORKLOADS.length - 1)) % WORKLOADS.length;
      e.preventDefault();
      select(WORKLOADS[next].id);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sel, select]);

  const domains = JSON.stringify(entries.map((e) => ({ id: e.id, label: e.label, color: STATUS[e.detail.status][0] })));
  const [statusColor, statusLabel] = entry ? STATUS[entry.detail.status] : ["", ""];
  const verifiedCount = Object.values(model.status).filter((s) => s === "verified").length;

  // The table: the selected workload's board, or every workload's when none is selected.
  const boards = (sel ? [WORKLOADS.find((w) => w.id === sel)!] : WORKLOADS).map((w) => ({ w, rows: boardOf(model, w.id, real) }));
  const open = (row: KernelRow) => router.push(`/models/${model.id}/kernels/${row.id}?workload=${row.workloadId}`);

  return (
    <div data-full-bleed className="min-h-[calc(100vh-4rem)] text-[15px] leading-normal">
      <section className="relative border-b border-border/60">
        <div className="relative overflow-hidden" style={{ height: narrow ? "clamp(480px, 62vh, 680px)" : "clamp(560px, calc(100vh - 4rem), 920px)" }}>
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

          {/*
           * A band across the top: the model on the left, its facts as a row
           * of cells on the right, inside the app's content width. It fades
           * out while a workload is zoomed in, so it never covers an orb.
           */}
          <div
            className={`absolute inset-x-0 top-0 transition-opacity duration-400 ${entry ? "pointer-events-none" : ""}`}
            style={{ opacity: entry ? 0 : 1 }}
          >
            <div className="mx-auto grid w-full max-w-6xl gap-5 px-4 pt-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:px-8">
              <div className="max-w-[560px]">
                <Link href="/models" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
                  <ArrowLeftIcon className="size-3.5" /> All models
                </Link>
                <h6 className="m-0 mb-1.5 text-xs tracking-[0.18em] text-muted-foreground uppercase">
                  {model.vendor} · {model.params} · {model.active}
                </h6>
                <h1 className="m-0 mb-2 font-display text-[40px] leading-[1.05] font-extrabold tracking-[-0.02em] text-pretty">{model.name}</h1>
                <p className="m-0 text-[15px] text-pretty text-muted-foreground">{model.summary}</p>
              </div>
              <dl className="m-0 hidden gap-px overflow-hidden rounded-lg border border-border/60 bg-border/60 text-xs backdrop-blur-sm md:mt-9 md:grid md:max-w-[620px] md:grid-cols-5">
                {(
                  [
                    ["Weights", `${model.quant} · ${model.sizeGb} GB`, true],
                    ["Context", `${model.contextK}K tokens`, true],
                    ["Runs on", model.hardware, false],
                    ["License", model.license, false],
                    ["Kernels", `${verifiedCount} of ${WORKLOADS.length} workloads`, false],
                  ] as [string, string, boolean][]
                ).map(([k, v, mono]) => (
                  <div key={k} className="bg-card/80 px-3 py-2.5">
                    <dt className="text-[10px] tracking-[0.12em] text-muted-foreground uppercase">{k}</dt>
                    <dd className={`mt-1 text-pretty ${mono ? "vtec-num" : ""}`}>{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>

          {/* What each orb colour means: one slim line along the bottom, the full meaning on hover. */}
          <dl
            className={`absolute inset-x-0 bottom-0 m-0 transition-opacity duration-400 ${entry ? "pointer-events-none" : ""}`}
            style={{ opacity: entry ? 0 : 1 }}
          >
            <div className="mx-auto flex w-full max-w-6xl flex-wrap gap-x-6 gap-y-1.5 px-4 pb-5 text-xs md:px-8">
              {LEGEND.map(([status, title, meaning]) => (
                <div key={status} className="inline-flex items-baseline gap-2" title={meaning}>
                  <dt className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <span className="size-2 rounded-full" style={{ background: STATUS[status][0] }} />
                    <span className="text-[11px] tracking-[0.08em] uppercase" style={{ color: STATUS[status][0] }}>{title}</span>
                  </dt>
                  <dd className="m-0 text-muted-foreground">{meaning.split(":")[0].split(" (")[0]}</dd>
                </div>
              ))}
            </div>
          </dl>
        </div>

        {entry ? (
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
                <h3 className="m-0 mb-2.5 font-display text-xl leading-[1.15] font-extrabold tracking-[-0.015em] text-pretty">{entry.kernel.name}</h3>
                <div className="flex flex-wrap items-center gap-2.5 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 px-2 py-0.5 text-xs" style={{ color: statusColor }}>
                    <span className="size-1.5 rounded-full" style={{ background: statusColor }} />
                    {statusLabel}
                  </span>
                  <span>{entry.detail.draw ? `verified by ${entry.detail.verifiers.length}/${entry.detail.verifiers.length}` : "awaiting verifier draw"}</span>
                  <span>{entry.kernel.of} kernel{entry.kernel.of === 1 ? "" : "s"} on this board</span>
                </div>
              </div>
              <Button variant="outline" className="flex-none rounded-full" onClick={() => select(null)}>
                <ArrowLeftIcon /> All workloads
              </Button>
            </div>
            <SkillChart entry={entry} sample />
          </aside>
        ) : null}
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 pt-9 pb-16 md:px-8">
        <div className="mb-8">
          <h2 className="text-3xl font-medium tracking-tight md:text-4xl">
            Kernel Code Efficiency Ranking{sel ? ` · ${WORKLOADS.find((w) => w.id === sel)!.label}` : ""}
          </h2>
          <p className="mt-2 max-w-2xl text-base text-muted-foreground">
            Kernels for {model.name}, ranked by verified speedup. Buy a license for {SUI.licenseSui} SUI: 70% goes to the tuner,
            20% to the kernel it improved on, 10% to VTEC. Open a kernel for how it improved the model, the harness
            conditions and its contract.
          </p>
        </div>

        {boards.map(({ w, rows }) => (
          <div key={w.id} className="mb-8">
            {!sel ? (
              <button
                type="button"
                onClick={() => select(w.id)}
                className={`mb-3 inline-flex items-center gap-2 text-sm tracking-[0.18em] uppercase transition-colors hover:text-foreground ${hover === w.id ? "text-foreground" : "text-muted-foreground"}`}
              >
                <span className="size-2 rounded-full" style={{ background: STATUS[entries.find((e) => e.id === w.id)!.detail.status][0] }} />
                {w.label}
              </button>
            ) : null}
            {rows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/70 bg-card/40 p-8 text-center text-sm text-muted-foreground">
                Nothing verified for {model.name} on {w.label} yet. The first kernel verifiers confirm takes #1.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>Kernel</TableHead>
                      <TableHead className="text-right">Speedup</TableHead>
                      <TableHead>Verified by</TableHead>
                      <TableHead>Tuner</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row, i) => {
                      const [color, status] = STATUS[row.status];
                      return (
                        <TableRow key={row.id} onClick={() => open(row)} className="cursor-pointer transition-colors hover:bg-accent/50">
                          <TableCell className="vtec-num">{row.status === "verified" ? i + 1 : "—"}</TableCell>
                          <TableCell>
                            <span className="block text-sm">{row.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {w.label} · <span className="vtec-num">{row.buildSha256.slice(0, 10)}…</span>
                              {row.sample ? " · sample" : " · verified on this platform"}
                            </span>
                          </TableCell>
                          <TableCell className="vtec-num text-right text-base font-medium" style={{ color }}>
                            {row.speedup ? `${row.speedup.toFixed(2)}×` : "—"}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {row.verifiers.passed}/{row.verifiers.total} passed
                            <span className="block text-xs">{row.harness ? "incl. platform harness" : status}</span>
                          </TableCell>
                          <TableCell className="vtec-num text-sm">{row.tuner ? shortAddress(row.tuner) : "—"}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              className="rounded-full"
                              disabled={!row.listing}
                              onClick={(e) => {
                                e.stopPropagation();
                                setBuying({ id: row.id, name: row.name, track: w.label, speedup: row.speedup, verifiers: row.verifiers, listing: row.listing });
                              }}
                            >
                              <ShoppingCartIcon /> {row.listing ? "Get kernel" : row.sample ? "Sample" : "Listing…"}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        ))}
        <p className="micro">
          ↑ ↓ to move between workloads · Esc for all · Sample rows are generated; rows marked verified on this platform
          come from real submissions and can be licensed.
        </p>
      </section>

      <GetKernelDialog row={buying} onClose={() => setBuying(null)} />
    </div>
  );
}
