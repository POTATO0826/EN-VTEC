"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeftIcon, ChevronDownIcon, ChevronUpIcon, ExternalLinkIcon, GitCommitHorizontalIcon, ShoppingCartIcon, SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import GetKernelDialog, { type Purchasable } from "@/components/models/GetKernel";
import Evidence from "@/components/results/Evidence";
import SkillChart from "@/components/results/SkillChart";
import { STATUS } from "@/components/results/status";
import { findWorkload, sampleDetail, type HistoryEntry, type KernelDetailData, type KernelRow, type Model, type WorkloadId } from "@/lib/models";
import { fmt, spokeStats, times, valueText, type ResultEntry } from "@/lib/results";
import { useSessionId } from "@/lib/session";
import { explorerTx, shortAddress, SUI } from "@/lib/sui-tx";

/**
 * One kernel, in full: how it improved the model, the harness it was verified
 * under, its contract on Sui, the code hash, and the submission history.
 * Kernels verified on this platform (ids starting sub_) load their real
 * evidence; sample kernels are generated.
 */
export default function KernelDetail({ model, workloadId, kernelId }: { model: Model; workloadId: WorkloadId; kernelId: string }) {
  const sessionId = useSessionId();
  const real = kernelId.startsWith("sub_");
  const [realData, setRealData] = React.useState<{ entry: ResultEntry; row: KernelRow | null; history: ResultEntry[] } | null>(null);
  const [buying, setBuying] = React.useState<Purchasable | null>(null);
  const w = findWorkload(workloadId)!;

  React.useEffect(() => {
    if (!real || !sessionId) return;
    let alive = true;
    const load = async () => {
      const [a, b] = await Promise.all([
        fetch(`/api/results?session=${sessionId}&id=${kernelId}`, { cache: "no-store" }),
        fetch(`/api/models/${model.id}`, { cache: "no-store" }),
      ]);
      if (!a.ok || !b.ok || !alive) return;
      const entries = (await a.json()).entries as ResultEntry[];
      const rows = (await b.json()).rows as KernelRow[];
      const entry = entries.find((e) => e.id === kernelId);
      if (entry) setRealData({ entry, row: rows.find((r) => r.id === kernelId) ?? null, history: entries.filter((e) => e.track === entry.track) });
    };
    load();
    const timer = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [real, sessionId, kernelId, model.id]);

  // Dates and times are formatted in the viewer's locale, so nothing renders until the page is on the client.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const sample = real ? null : sampleDetail(model, workloadId, kernelId);
  if (!real && !sample) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10 md:px-8">
        <p className="text-sm text-muted-foreground">That kernel isn&apos;t on this board.</p>
        <Back model={model} workloadId={workloadId} />
      </div>
    );
  }
  if ((real && !realData) || !mounted) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10 md:px-8">
        <Back model={model} workloadId={workloadId} />
        <div className="mt-6 h-64 animate-pulse rounded-xl border border-border/60 bg-card/40" />
      </div>
    );
  }

  const entry = real ? realData!.entry : sample!.entry;
  const d = entry.detail;
  const [color, label] = STATUS[d.status];
  const speedup = d.outcome?.speedup ?? null;
  const name = real ? entry.kernel.name : sample!.row.name;
  const purchasable: Purchasable | null = real
    ? realData!.row
      ? { id: kernelId, name, track: w.label, speedup, verifiers: { total: d.verifiers.length }, listing: realData!.row.listing }
      : null
    : null;
  const stats = spokeStats(entry).filter((s) => s.measured);
  const passes = d.verifiers.filter((v) => v.report?.pass).length;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-2 md:px-8">
      <Back model={model} workloadId={workloadId} />

      {/* Header */}
      <div className="mt-6 mb-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <ModelBadge model={model} />
            <span className="text-xs tracking-[0.18em] text-muted-foreground uppercase">
              {w.label} · {w.workload}
            </span>
          </div>
          <h1 className="font-display text-[40px] leading-[1.05] font-extrabold tracking-[-0.02em] text-pretty md:text-[44px]">{name}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2.5 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 px-2 py-0.5 text-xs" style={{ color }}>
              <span className="size-1.5 rounded-full" style={{ background: color }} /> {label}
            </span>
            <span>
              {passes}/{d.verifiers.length} verifiers passed it{d.harness ? " · incl. platform harness" : ""}
            </span>
            <span>{entry.kernel.rank ? `rank #${entry.kernel.rank} of ${entry.kernel.of}` : `unranked · ${entry.kernel.of} on this board`}</span>
            {real ? <span>verified on this platform</span> : <span>sample kernel</span>}
          </div>
        </div>
        <div className="flex items-end gap-4">
          <div>
            <div className="text-xs tracking-[0.18em] text-muted-foreground uppercase">Verified speedup</div>
            <div className="vtec-num text-[44px] leading-none font-medium" style={{ color }}>
              {times(speedup)}
            </div>
          </div>
          <Button className="rounded-full px-5" disabled={!purchasable?.listing} onClick={() => setBuying(purchasable)}>
            <ShoppingCartIcon /> {purchasable?.listing ? `Get kernel · ${SUI.licenseSui} SUI` : real ? "Listing…" : "Sample"}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* How it improved the model */}
        <Card title="How it improved the model" className="flex flex-col gap-5">
          <SkillChart entry={entry} sample={!real} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] tracking-[0.08em] text-muted-foreground uppercase">
                  <th className="py-1.5 font-normal">Metric</th>
                  <th className="py-1.5 text-right font-normal">Baseline</th>
                  <th className="py-1.5 text-right font-normal">This kernel</th>
                  <th className="py-1.5 text-right font-normal">Change</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s) => {
                  const better = s.med >= 0;
                  return (
                    <tr key={s.key} className="border-t border-border/60">
                      <td className="py-2">{s.name}</td>
                      <td className="vtec-num py-2 text-right text-muted-foreground">{s.scale === "tolerance" ? `≤ ${valueText(s, s.baseline)}` : valueText(s, s.baseline)}</td>
                      <td className="vtec-num py-2 text-right">{s.medianText}</td>
                      <td className={`vtec-num py-2 text-right ${better ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{s.scale === "tolerance" ? `${Math.round(s.med)} / 100` : s.deltaText.replace(" vs baseline", "")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="flex flex-col gap-6">
          {/* Harness conditions */}
          <Card title="Harness conditions">
            <Facts
              rows={
                real
                  ? [
                      ["GPU", d.gpu],
                      ["Verifier hardware", d.verifiers.map((v) => v.hardware).filter(Boolean).join(" · ") || "—"],
                      ["AI model", `${model.name} · ${model.quant} · ${model.contextK}K context`],
                      ["Runs", `${d.verifiers[0]?.report?.runs ?? "—"} seeded runs per verifier, baseline and kernel alternated`],
                      ["Noise", stats.find((s) => s.key === "noise")?.medianText ?? "—"],
                      ["Electricity", "Not metered by this harness yet: the agent times runs but doesn't read GPU power."],
                      ["Output check", d.verifiers.every((v) => v.report?.identical !== false) ? "Identical to the baseline within the track's tolerance on every seed" : "Differed from the baseline"],
                    ]
                  : [
                      ["GPU", sample!.harness.gpu],
                      ["CPU", sample!.harness.cpu],
                      ["Driver", sample!.harness.driver],
                      ["AI model", sample!.harness.model],
                      ["Runs", `${sample!.harness.runs} seeded runs per verifier, baseline and kernel alternated`],
                      ["Noise", `±${sample!.harness.noisePct}% run to run`],
                      ["Electricity", `${sample!.harness.energyPerRunJ} J per run · ${sample!.harness.avgPowerW} W average over ${sample!.harness.durationS} s`],
                      ["Output check", "Identical to the baseline within 1e-3 on every seed"],
                    ]
              }
            />
          </Card>

          {/* Smart contract */}
          <Card title="Smart contract · Sui">
            <Facts
              rows={
                real
                  ? [
                      ["Listing", realData!.row?.listing ? <Tx id={realData!.row.listing.id} kind="object" /> : "not listed yet"],
                      ["Listed in", realData!.row?.listing ? <Tx id={realData!.row.listing.digest} /> : "—"],
                      ["License price", `${SUI.licenseSui} SUI · 70% tuner · 20% lineage · 10% VTEC, in one transaction`],
                      ["Lineage", realData!.row?.listing ? shortAddress(realData!.row.listing.lineage) : "—"],
                      ["Tuner", realData!.row?.tuner ? shortAddress(realData!.row.tuner) : "—"],
                      ["Process fee", d.approval?.fee ? <Tx id={d.approval.fee.digest} label={`${d.approval.fee.amountSui} SUI · view`} /> : "none (legacy)"],
                      ["Fee settlement", d.feeSettlement ? <Tx id={d.feeSettlement.digest} label={`split between ${d.feeSettlement.recipients} · view`} /> : "pending"],
                      ["World ID", d.approval?.worldId ? "Submission approved by a verified human" : "not required at the time"],
                    ]
                  : [
                      ["Listing", sample!.contract.listingId ? shortAddress(sample!.contract.listingId) : "not listed (rejected)"],
                      ["Listed in", sample!.contract.listingTx ? `${sample!.contract.listingTx.slice(0, 12)}…` : "—"],
                      ["License price", `${sample!.contract.licenseSui} SUI · ${sample!.contract.split.join("% / ")}% tuner / lineage / VTEC`],
                      ["Licenses sold", sample!.contract.licensesSold ?? "—"],
                      ["Lineage", sample!.contract.lineage ? shortAddress(sample!.contract.lineage) : "—"],
                      ["Tuner", sample!.row.tuner ? shortAddress(sample!.row.tuner) : "—"],
                      ["Process fee", `0.01 SUI · ${sample!.contract.feeTx!.slice(0, 12)}…`],
                      ["World ID", "Submission approved by a verified human"],
                    ]
              }
            />
          </Card>

          {/* Kernel */}
          <Card title="Kernel">
            <Facts
              rows={
                real
                  ? [
                      ["Build SHA-256", <Hash key="b" value={d.buildSha256} />],
                      ["Track", entry.track],
                      ["Submitted", new Date(d.submittedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })],
                      ["Tuner's own run", `${d.runtimeS.toFixed(2)} s on ${d.gpu}`],
                    ]
                  : [
                      ["Build SHA-256", <Hash key="b" value={sample!.kernel.buildSha256} />],
                      ["Spec SHA-256", <Hash key="s" value={sample!.kernel.specSha256} />],
                      ["Output SHA-256", <Hash key="o" value={sample!.kernel.resultSha256} />],
                      ["Files", `${sample!.kernel.files} · run: ${sample!.kernel.run}`],
                      ["Submitted", new Date(d.submittedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })],
                    ]
              }
            />
          </Card>
        </div>
      </div>

      {/* Every step with the evidence */}
      <div className="mt-2">
        <Evidence entry={entry} sample={!real} />
      </div>

      {/* Submission history, every entry on the same model */}
      <History
        model={model}
        title={`${model.name} · ${w.label}`}
        entries={
          real
            ? realData!.history
                .filter((e) => e.detail.outcome)
                .map((e) => ({
                  at: e.detail.outcome!.at,
                  note: `${e.kernel.name}: ${e.detail.status === "verified" ? `verified at ${times(e.detail.outcome!.speedup)}` : "not proven faster"}`,
                  fullNote: `${e.detail.verifiers.map((v) => `${v.who}: ${v.report?.reason ?? v.incompatible ?? "running"}`).join(" ")}`,
                  status: e.detail.status === "verified" ? "verified" : e.detail.status === "rejected" ? "rejected" : "pending",
                  score: e.detail.outcome!.speedup ?? 0,
                  landed: e.detail.status === "verified",
                }))
            : sample!.history
        }
        scoreOf={(h) => (real ? times(h.score) : `${fmt(h.score, 1)} tok/s`)}
        scoreLabel={real ? "speedup" : "decode tok/s"}
      />

      <GetKernelDialog row={buying} onClose={() => setBuying(null)} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Back({ model, workloadId }: { model: Model; workloadId: WorkloadId }) {
  return (
    <Link href={`/models/${model.id}?workload=${workloadId}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
      <ArrowLeftIcon className="size-3.5" /> {model.name} · all kernels
    </Link>
  );
}

export function ModelBadge({ model }: { model: Model }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card/60 px-2.5 py-0.5 text-xs">
      <SparklesIcon className="size-3.5 text-muted-foreground" /> {model.name}
    </span>
  );
}

function Card({ title, className, children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-xl border border-border/60 bg-card/60 p-5 backdrop-blur-sm ${className ?? ""}`}>
      <h2 className="mb-3 text-sm tracking-[0.18em] text-muted-foreground uppercase">{title}</h2>
      {children}
    </div>
  );
}

function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-4 text-sm">
      {rows.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt className="border-t border-border/60 py-2 text-xs text-muted-foreground">{k}</dt>
          <dd className="border-t border-border/60 py-2 [overflow-wrap:anywhere]">{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

function Hash({ value }: { value: string }) {
  return <span className="vtec-num text-xs">{value}</span>;
}

function Tx({ id, kind = "tx", label = "view on Sui" }: { id: string; kind?: "tx" | "object"; label?: string }) {
  const href = kind === "tx" ? explorerTx(id) : explorerTx(id).replace("/tx/", "/object/");
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline">
      {kind === "object" ? shortAddress(id) : label} <ExternalLinkIcon className="size-3" />
    </a>
  );
}

/** The submission timeline: personal best and standing up top, one row per submission, all on the same model. */
function History({
  model,
  title,
  entries,
  scoreOf,
  scoreLabel,
}: {
  model: Model;
  title: string;
  entries: HistoryEntry[];
  scoreOf: (h: HistoryEntry) => string;
  scoreLabel: string;
}) {
  const [open, setOpen] = React.useState<number | null>(null);
  const [collapsed, setCollapsed] = React.useState(false);
  const sorted = [...entries].sort((a, b) => b.at.localeCompare(a.at));
  const landed = sorted.filter((h) => h.landed);
  const best = landed.length ? landed.reduce((a, b) => (b.score > a.score ? b : a)) : null;
  const standing = best ? landed.filter((h) => h.score > best.score).length + 1 : null;
  return (
    <section className="mx-auto mb-16 w-full max-w-6xl">
      <div className="overflow-hidden rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 bg-accent/40 px-5 py-4">
          <h2 className="text-lg font-medium">Submission history · {title}</h2>
          <div className="flex items-center gap-6">
            <div className="text-right">
              <div className="text-[10px] tracking-[0.18em] text-muted-foreground uppercase">Personal best · {scoreLabel}</div>
              <div className="vtec-num text-lg">{best ? scoreOf(best) : "—"}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] tracking-[0.18em] text-muted-foreground uppercase">Standing</div>
              <div className="vtec-num text-lg">{standing ? `${standing} / ${Math.max(landed.length, standing)}` : "—"}</div>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={() => setCollapsed((c) => !c)} aria-label="Toggle history">
              {collapsed ? <ChevronDownIcon /> : <ChevronUpIcon />}
            </Button>
          </div>
        </div>
        {collapsed ? null : sorted.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">No decided submissions on this workload yet.</p>
        ) : (
          <ol className="relative ml-4 border-l border-border/60 py-2 pr-5">
            {sorted.map((h, i) => (
              <li key={`${h.at}-${i}`} className="relative py-4 pl-8">
                <span className="absolute top-5 -left-[5px] size-2.5 rounded-full border-2 border-[var(--info)] bg-background" />
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="vtec-num text-xs text-muted-foreground">{new Date(h.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</div>
                    <div className="mt-1 text-sm">{h.note}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <ModelBadge model={model} />
                      <span className="inline-flex items-center gap-1" style={{ color: h.landed ? "var(--success)" : "var(--danger)" }}>
                        <GitCommitHorizontalIcon className="size-3.5" /> {h.landed ? "landed · verified" : h.status === "pending" ? "pending" : "rejected"}
                      </span>
                      <button type="button" onClick={() => setOpen(open === i ? null : i)} className="text-foreground underline-offset-4 hover:underline">
                        {open === i ? "Hide note" : "View full note"}
                      </button>
                    </div>
                    {open === i ? <p className="mt-2 max-w-[70ch] text-sm text-muted-foreground">{h.fullNote}</p> : null}
                  </div>
                  <div className="vtec-num text-lg whitespace-nowrap">{scoreOf(h)}</div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
