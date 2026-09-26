"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "cn";
import {
  CheckIcon,
  CoinsIcon,
  DicesIcon,
  ExternalLinkIcon,
  FileCodeIcon,
  LaptopIcon,
  LoaderIcon,
  ScanFaceIcon,
  TrophyIcon,
  XIcon,
} from "lucide-react";
import { StatusBadge, type Status } from "@/components/ui/status-badge";
import { explorerTx, SUI } from "@/lib/sui-tx";

type Report = {
  compatible: boolean;
  reason?: string;
  hardware: string;
  hashMatches: boolean;
  correct: boolean;
  runs: number;
  baselineMedianMs: number;
  candidateMedianMs: number;
  noisePct: number;
  speedup: number;
  pass: boolean;
};

type Detail = {
  id: string;
  track: string;
  trackId: string;
  mine: boolean;
  status: Status;
  buildName: string;
  buildSha256: string;
  gpu: string;
  seconds: number;
  speedup: number | null;
  at: string;
  settledAt: string | null;
  approval: { worldId: boolean; fee: { digest: string; amountMist: string } | null } | null;
  draw: { seed: string; source: string } | null;
  quorum: number;
  harness: boolean;
  harnessRunning: boolean;
  verifiers: { who: string; platform: boolean; status: string; report: Report | null; reason: string | null }[];
  feeSettlement: { digest: string; recipients: string[] } | null;
};

export function useSubmission(id: string | null, sessionId: string | null) {
  const [detail, setDetail] = React.useState<Detail | null>(null);
  React.useEffect(() => {
    if (!id) return setDetail(null);
    let alive = true;
    const load = async () => {
      const res = await fetch(`/api/submissions/${id}?session=${sessionId ?? ""}`, { cache: "no-store" });
      if (res.ok && alive) setDetail(await res.json());
    };
    load();
    const timer = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [id, sessionId]);
  return detail;
}

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function SubmissionDetail({ detail }: { detail: Detail }) {
  const done = detail.status === "verified" || detail.status === "rejected";
  const ran = detail.verifiers.filter((v) => v.report);
  const waiting = detail.verifiers.filter((v) => !v.report);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={detail.status} />
        <span className="text-sm text-muted-foreground">
          {detail.track} · {detail.buildName}
        </span>
      </div>

      <ol className="relative flex flex-col gap-5 border-l border-border/70 pl-6">
        <Event icon={<FileCodeIcon />} state="done" title="Submitted by your agent" when={time(detail.at)}>
          Exact code hashed and uploaded. <Mono>{detail.buildSha256.slice(0, 16)}…</Mono> on {detail.gpu}, took{" "}
          {detail.seconds.toFixed(1)} s there.
        </Event>

        <Event icon={<ScanFaceIcon />} state={detail.approval?.worldId ? "done" : "skipped"} title="Approved with World ID">
          {detail.approval?.worldId ? "A verified human approved this one submission." : "Made before approvals existed."}
        </Event>

        <Event icon={<CoinsIcon />} state={detail.approval?.fee ? "done" : "skipped"} title={`${SUI.feeSui} SUI process fee`}>
          {detail.approval?.fee ? (
            <>
              Paid and held in the VTEC vault on Sui. <TxLink digest={detail.approval.fee.digest} />
            </>
          ) : (
            "No fee on this submission (made before the fee existed)."
          )}
        </Event>

        <Event
          icon={<DicesIcon />}
          state={detail.draw ? "done" : "current"}
          title={detail.draw ? `Verifiers drawn: ${detail.verifiers.map((v) => v.who).join(", ")}` : "Drawing verifiers…"}
        >
          {detail.draw ? (
            <>
              {detail.draw.source === "server" ? "Picked with server randomness." : "Picked with Sui on-chain randomness."}{" "}
              {detail.draw.source !== "server" ? <TxLink digest={detail.draw.source} /> : null}
              {detail.harness ? (
                <span className="mt-1 block">
                  Too few people in the pool, so the platform harness stood in. {detail.quorum} of{" "}
                  {detail.verifiers.length} must agree.
                </span>
              ) : null}
            </>
          ) : (
            "Waiting for enough verifiers."
          )}
        </Event>

        <Event
          icon={<LaptopIcon />}
          state={ran.length === detail.verifiers.length && detail.verifiers.length > 0 ? "done" : detail.draw ? "current" : "todo"}
          title={`Re-run on verifiers' hardware (${ran.length}/${detail.verifiers.length || "…"})`}
        >
          {waiting.length > 0 && detail.draw ? (
            <span className="mb-3 flex items-center gap-2">
              <LoaderIcon className="size-3.5 animate-spin" />
              {waiting.map((v) => v.who).join(", ")}{" "}
              {waiting.some((v) => v.platform) && detail.harnessRunning ? "running baseline vs your build now…" : "still to report."}
            </span>
          ) : null}
          <div className="flex flex-col gap-3">
            {ran.map((v) => (
              <VerifierResult key={v.who} who={v.who} report={v.report!} reason={v.reason!} />
            ))}
          </div>
        </Event>

        <Event
          icon={done ? detail.status === "verified" ? <TrophyIcon /> : <XIcon /> : <CheckIcon />}
          state={done ? (detail.status === "verified" ? "done" : "failed") : "todo"}
          title={
            detail.status === "verified"
              ? `Verified at ${detail.speedup?.toFixed(2)}×, now on the ranking`
              : detail.status === "rejected"
                ? "Rejected: not proven faster"
                : "Result"
          }
          when={detail.settledAt ? time(detail.settledAt) : undefined}
        >
          {detail.status === "verified" ? (
            <Link href="/ranking" className="underline-offset-4 hover:underline">
              See the Kernel Code Efficiency Ranking
            </Link>
          ) : detail.status === "rejected" ? (
            "It stays off the ranking. Try a build that's faster than the baseline."
          ) : (
            "Decided once enough verifiers agree."
          )}
          {detail.feeSettlement ? (
            <span className="mt-1 block">
              {detail.feeSettlement.recipients.length === 1
                ? "Fee paid out to the verifier."
                : `Fee split between ${detail.feeSettlement.recipients.length} verifiers.`}{" "}
              <TxLink digest={detail.feeSettlement.digest} />
            </span>
          ) : null}
        </Event>
      </ol>
    </div>
  );
}

/** One verifier's measurements as two bars: shorter bar = faster. */
function VerifierResult({ who, report, reason }: { who: string; report: Report; reason: string }) {
  if (!report.compatible) {
    return (
      <div className="rounded-lg border border-border/60 bg-black/20 p-3 text-sm">
        <span className="font-medium">{who}</span> · <span className="text-muted-foreground">{reason}</span>
      </div>
    );
  }
  const max = Math.max(report.baselineMedianMs, report.candidateMedianMs);
  const bars = [
    { label: "Baseline", ms: report.baselineMedianMs, tone: "bg-muted-foreground/60" },
    { label: "This build", ms: report.candidateMedianMs, tone: report.pass ? "bg-[var(--success)]" : "bg-[var(--danger)]" },
  ];
  return (
    <div className="rounded-lg border border-border/60 bg-black/20 p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium">
          {who} <span className="font-normal text-muted-foreground">· {report.hardware}</span>
        </span>
        <span
          className={cn(
            "vtec-num text-lg font-medium",
            report.pass ? "text-[var(--success)]" : "text-[var(--danger)]",
          )}
        >
          {report.speedup.toFixed(2)}×
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {bars.map((bar) => (
          <div key={bar.label} className="grid grid-cols-[84px_1fr_64px] items-center gap-3 text-xs">
            <span className="text-muted-foreground">{bar.label}</span>
            <span className="h-2.5 overflow-hidden rounded-full bg-border/40">
              <span
                className={cn("block h-full rounded-full transition-[width] duration-700", bar.tone)}
                style={{ width: `${(bar.ms / max) * 100}%` }}
              />
            </span>
            <span className="vtec-num text-right">{(bar.ms / 1000).toFixed(2)} s</span>
          </div>
        ))}
      </div>
      <p className="mt-3 flex items-start gap-2 text-sm">
        {report.pass ? (
          <CheckIcon className="mt-0.5 size-4 shrink-0 text-[var(--success)]" />
        ) : (
          <XIcon className="mt-0.5 size-4 shrink-0 text-[var(--danger)]" />
        )}
        <span>
          {reason}{" "}
          <span className="text-muted-foreground">
            ({report.runs} seeded runs each, output {report.correct ? "identical" : "different"})
          </span>
        </span>
      </p>
    </div>
  );
}

function Event({
  icon,
  title,
  when,
  state,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  when?: string;
  state: "done" | "current" | "todo" | "failed" | "skipped";
  children?: React.ReactNode;
}) {
  return (
    <li className="relative">
      <span
        className={cn(
          "absolute top-0 -left-[37px] inline-flex size-6 items-center justify-center rounded-full border bg-background [&>svg]:size-3.5",
          state === "done" && "border-[var(--success)] text-[var(--success)]",
          state === "current" && "border-[var(--warning)] text-[var(--warning)]",
          state === "failed" && "border-[var(--danger)] text-[var(--danger)]",
          (state === "todo" || state === "skipped") && "border-border text-muted-foreground",
        )}
      >
        {icon}
      </span>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className={cn("text-sm font-medium", (state === "todo" || state === "skipped") && "text-muted-foreground")}>
          {title}
        </p>
        {when ? <span className="text-xs text-muted-foreground">{when}</span> : null}
      </div>
      {children ? <div className="mt-1 text-sm text-muted-foreground">{children}</div> : null}
    </li>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="vtec-num text-foreground">{children}</span>;
}

function TxLink({ digest }: { digest: string }) {
  return (
    <a
      href={explorerTx(digest)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline"
    >
      view on Sui <ExternalLinkIcon className="size-3" />
    </a>
  );
}
