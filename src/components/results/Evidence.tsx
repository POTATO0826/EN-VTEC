"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRightIcon, CheckIcon, ChevronDownIcon, ExternalLinkIcon, LoaderIcon, MinusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { findTrack } from "@/lib/catalog";
import { buildSteps, times, type ResultEntry, type Step, type VerifierRun } from "@/lib/results";
import { explorerTx } from "@/lib/sui-tx";
import { STATUS } from "./status";

/** The outcome, the facts, and every step with its evidence. */
export default function Evidence({ entry, sample }: { entry: ResultEntry; sample: boolean }) {
  const d = entry.detail;
  const [color, label] = STATUS[d.status];
  const ran = d.verifiers.filter((v) => v.reported).length;
  const total = d.verifiers.length;
  const passes = d.verifiers.flatMap((v) => (v.report?.pass ? [v.report.speedup] : [])).sort((a, b) => a - b);
  const [open, setOpen] = React.useState<Record<string, boolean>>({});

  let title: string;
  let sub: string;
  if (d.status === "verified") {
    title = `Verified at ${times(d.outcome?.speedup)}`;
    sub = `${passes.length} of ${total} verifiers reproduced the gain on their own ${entry.hardware} hardware${d.harness ? ", including the platform harness" : ""}. Now on the Kernel Code Efficiency Ranking.`;
  } else if (d.status === "rejected") {
    title = "Not proven faster";
    sub =
      d.outcome?.speedup != null
        ? `Verifiers measured ${times(d.outcome.speedup)}, not a proven gain over the baseline. The build isn't ranked; the fee went to the verifiers who ran it.`
        : "Verifiers didn't get the baseline's output from this build, so it isn't correct. It isn't ranked; the fee went to the verifiers who ran it.";
  } else if (!d.draw) {
    title = "Verdict pending";
    sub = "Waiting for enough verifiers with matching hardware to join the pool. The draw happens automatically.";
  } else {
    const provisional = passes.length ? passes[passes.length >> 1] : null;
    title = provisional ? `${times(provisional)} provisional` : "Verdict pending";
    sub = `${ran} of ${total} verifiers have reported. Decided once ${d.quorum} agree.`;
  }

  const fee = d.approval?.fee;
  const meta: [string, string, boolean?][] = [
    ["Track", entry.track, true],
    ["Build", `${d.buildSha256.slice(0, 16)}…`, true],
    ["Hardware", `${entry.hardware} · ${entry.model}`],
    ["Submitted", new Date(d.submittedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })],
    ["Fee", fee ? `${fee.amountSui} SUI · ${d.feeSettlement ? "paid to verifiers" : "held in vault"}` : "none (legacy)"],
    ["Verified by", d.draw ? `${ran} / ${total}${d.harness ? " · platform harness" : ""}` : "awaiting draw"],
  ];
  const trackPage = !sample && findTrack(entry.track) ? `/tuners/${entry.track}` : null;

  return (
    <section className="mx-auto w-full max-w-6xl px-4 pt-9 pb-16 md:px-8">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] items-start gap-8 pb-7">
        <div>
          <h6 className="m-0 mb-2.5 font-display text-[11px] font-extrabold tracking-[0.1em] uppercase" style={{ color }}>
            Outcome · {label}
          </h6>
          <h1 className="m-0 mb-3 font-display text-[44px] leading-[1.02] font-extrabold tracking-[-0.02em] text-pretty tabular-nums">
            {title}
          </h1>
          <p className="m-0 mb-4 max-w-[52ch] text-[15px] text-pretty text-muted-foreground">{sub}</p>
          <div className="flex flex-wrap gap-2">
            {d.status === "verified" ? (
              <Button asChild className="rounded-full px-5">
                <Link href="/ranking">
                  View the ranking <ArrowRightIcon />
                </Link>
              </Button>
            ) : null}
            {trackPage ? (
              <Button asChild variant="outline" className="rounded-full">
                <Link href={trackPage}>Open the track</Link>
              </Button>
            ) : null}
          </div>
        </div>
        <dl className="m-0 grid grid-cols-[110px_minmax(0,1fr)] border-t border-border text-[13px]">
          {meta.map(([k, v, mono]) => (
            <React.Fragment key={k}>
              <dt className="border-b border-border/60 py-2.5 text-[11px] tracking-[0.08em] text-muted-foreground uppercase">{k}</dt>
              <dd className={`m-0 border-b border-border/60 py-2.5 [overflow-wrap:anywhere] ${mono ? "vtec-num" : ""}`}>{v}</dd>
            </React.Fragment>
          ))}
        </dl>
      </div>

      <div className="border-t border-border">
        {buildSteps(d, explorerTx).map((step) => (
          <StepRow
            key={step.id}
            step={step}
            open={!!open[step.id]}
            onToggle={() => setOpen((o) => ({ ...o, [step.id]: !o[step.id] }))}
            harnessRunning={d.harnessRunning}
          />
        ))}
      </div>
      <p className="micro mt-4">
        {sample
          ? "Sample data · every number above is mock."
          : "Every number above comes from the verifiers' own reports. Updates live."}
      </p>
    </section>
  );
}

const STEP_COLOR = {
  done: ["text-[var(--success)]", "text-foreground"],
  current: ["text-[var(--warning)]", "text-foreground"],
  todo: ["text-muted-foreground/60", "text-muted-foreground"],
  failed: ["text-[var(--danger)]", "text-foreground"],
  skipped: ["text-muted-foreground/60", "text-muted-foreground"],
} as const;

function StepRow({
  step: s,
  open,
  onToggle,
  harnessRunning,
}: {
  step: Step;
  open: boolean;
  onToggle: () => void;
  harnessRunning: boolean;
}) {
  const [iconColor, titleColor] = STEP_COLOR[s.state];
  return (
    <div className="border-b border-border/60">
      <div className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-start gap-3.5 py-3.5">
        <div className={`mt-px grid size-6 place-items-center ${iconColor}`}>
          {s.state === "done" ? <CheckIcon className="size-5" strokeWidth={2.2} /> : null}
          {s.state === "failed" ? <XIcon className="size-5" strokeWidth={2.2} /> : null}
          {s.state === "skipped" ? <MinusIcon className="size-5" strokeWidth={2.2} /> : null}
          {s.state === "todo" ? <span className="block size-2.5 rounded-full border-2 border-current" /> : null}
          {s.state === "current" ? <Spinner /> : null}
        </div>
        <div className="min-w-0">
          <div className={`font-display text-[15px] leading-[1.3] font-extrabold ${titleColor}`}>{s.title}</div>
          <div className="mt-0.5 text-[13px] text-pretty text-muted-foreground [overflow-wrap:anywhere]">{s.summary}</div>
        </div>
        <div className="flex items-center gap-3 text-xs whitespace-nowrap text-muted-foreground">
          {s.time ? <span className="vtec-num">{s.time}</span> : null}
          {s.link ? <StepLink href={s.link.href}>{s.link.label}</StepLink> : null}
          {s.detail?.length ? (
            <Button variant="ghost" size="icon-sm" onClick={onToggle} aria-expanded={open} aria-label="Toggle details">
              <ChevronDownIcon className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
            </Button>
          ) : null}
        </div>
      </div>
      {open && s.detail ? (
        <div className="flex flex-col gap-1 pb-3.5 pl-[42px] text-[13px] text-muted-foreground">
          {s.detail.map((line) => (
            <div key={line} className="[overflow-wrap:anywhere]">
              {line}
            </div>
          ))}
        </div>
      ) : null}
      {s.reports?.length ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-3 pb-4 pl-[42px]">
          {s.reports.map((r) => (
            <ReportCard key={r.who} run={r} harnessRunning={harnessRunning} />
          ))}
        </div>
      ) : null}
      {s.settlement ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1.5 pb-3.5 pl-[42px] text-[13px] text-muted-foreground">
          <span>{s.settlement.text}</span>
          <StepLink href={s.settlement.href}>view on Sui</StepLink>
        </div>
      ) : null}
    </div>
  );
}

/** One verifier's measurements as two bars: shorter bar = faster. */
function ReportCard({ run, harnessRunning }: { run: VerifierRun; harnessRunning: boolean }) {
  const r = run.report;
  const color = r ? (r.pass ? "var(--success)" : "var(--danger)") : !run.reported ? "var(--warning)" : "var(--muted-foreground)";
  const max = r ? Math.max(r.baselineS, r.candidateS) : 1;
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border/60 bg-card/60 p-4 backdrop-blur-sm">
      <div className="text-xs text-pretty text-muted-foreground">
        <span className="font-medium text-foreground">{run.who}</span>
        {run.hardware ? ` · ${run.hardware}` : ""}
      </div>
      {!run.reported ? (
        <div className="flex items-center gap-2.5 text-[13px] text-[var(--warning)]">
          <Spinner />
          <span>
            {run.who === "Platform harness" && harnessRunning
              ? "running baseline vs this build now…"
              : "running baseline vs this build…"}
          </span>
        </div>
      ) : run.incompatible ? (
        <div className="text-[13px] text-muted-foreground">
          <span className="font-medium text-foreground">Incompatible.</span> {run.incompatible}
        </div>
      ) : r ? (
        <>
          <div className="vtec-num text-[34px] leading-none font-medium" style={{ color }}>
            {r.speedup.toFixed(2)}×
          </div>
          <div className="grid grid-cols-[70px_minmax(0,1fr)_62px] items-center gap-x-3 gap-y-2 text-xs">
            <span className="text-muted-foreground">Baseline</span>
            <div className="h-2.5 overflow-hidden rounded-full bg-border/40">
              <div className="h-full rounded-full bg-muted-foreground/60 transition-[width] duration-700" style={{ width: `${(r.baselineS / max) * 100}%` }} />
            </div>
            <span className="vtec-num text-right">{r.baselineS.toFixed(2)} s</span>
            <span className="text-muted-foreground">This build</span>
            <div className="h-2.5 overflow-hidden rounded-full bg-border/40">
              <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${(r.candidateS / max) * 100}%`, background: color }} />
            </div>
            <span className="vtec-num text-right">{r.candidateS.toFixed(2)} s</span>
          </div>
          <div className="flex items-start gap-2 text-[13px] text-pretty text-muted-foreground">
            <span className="mt-px flex-none" style={{ color }}>
              {r.pass ? <CheckIcon className="size-4" strokeWidth={2.4} /> : <XIcon className="size-4" strokeWidth={2.4} />}
            </span>
            <span>
              {r.reason} ({r.runs} seeded runs each, output {r.identical ? "identical" : "differs"})
            </span>
          </div>
        </>
      ) : null}
    </div>
  );
}

function StepLink({ href, children }: { href: string; children: React.ReactNode }) {
  const external = href.startsWith("http");
  const cls = "inline-flex items-center gap-1 text-xs text-foreground underline-offset-4 hover:underline";
  return external ? (
    <a href={href} target="_blank" rel="noreferrer" className={cls}>
      {children}
      <ExternalLinkIcon className="size-3" />
    </a>
  ) : (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

export function Spinner() {
  return <LoaderIcon className="size-[18px] flex-none animate-spin motion-reduce:animate-none" strokeWidth={2.2} />;
}
