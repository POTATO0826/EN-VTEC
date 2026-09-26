"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRightIcon } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge, type Status } from "@/components/ui/status-badge";
import { PageTitle } from "@/components/ui/step";
import { CommandBlock } from "@/components/tuners/TrackView";
import WorldIdButton, { postJson } from "@/components/world/WorldIdButton";
import { useSessionId, useSessionStatus } from "@/lib/session";

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

type Assignment = {
  id: string;
  status: "assigned" | "approved" | "committed" | "revealed";
  report: Report | null;
  submission: {
    id: string;
    track: string;
    trackId: string;
    buildName: string;
    buildSha256: string;
    gpu: string;
    status: Status;
    speedup: number | null;
  };
  progress: { committed: number; revealed: number; total: number; revealOpen: boolean };
};

type Me = {
  harness: {
    running: boolean;
    jobs: {
      submissionId: string;
      trackId: string;
      track: string;
      buildName: string;
      status: string;
      speedup: number | null;
      pass: boolean | null;
    }[];
  };
  poolSize: number;
  config: { poolSize: number; quorum: number };
  verifier: { reputation: number; joinedAt: string } | null;
  assignments: Assignment[];
};

export default function VerifyView() {
  const sessionId = useSessionId();
  const { status } = useSessionStatus(sessionId);
  const [me, setMe] = React.useState<Me | null>(null);

  const refresh = React.useCallback(async () => {
    if (!sessionId) return;
    const res = await fetch(`/api/verify/me?session=${sessionId}`, { cache: "no-store" });
    if (res.ok) setMe(await res.json());
  }, [sessionId]);
  React.useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [refresh]);

  return (
    <>
      <PageTitle
        title="Verify"
        subtitle="Nothing reaches the Kernel Code Efficiency Ranking until independent, real people re-run it on their own hardware."
      />

      {me && me.harness.jobs.length > 0 ? (
        <section className="mb-8 flex flex-col gap-3">
          <h2 className="flex items-center gap-2 text-sm tracking-[0.18em] text-muted-foreground uppercase">
            Platform harness
            {me.harness.running ? (
              <span className="inline-flex items-center gap-1.5 text-[11px] tracking-normal text-[var(--warning)] normal-case">
                <span className="size-1.5 animate-pulse rounded-full bg-[var(--warning)]" /> running now
              </span>
            ) : null}
          </h2>
          <p className="text-sm text-muted-foreground">
            While the pool is small, the platform runs the same verifier agent on its own machine. Open a job to see
            how it was verified: every run, the pass rule and the on-chain receipts.
          </p>
          <div className="overflow-hidden rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm">
            {me.harness.jobs.map((job) => (
              <Link
                key={job.submissionId}
                href={`/verify/${job.submissionId}`}
                className="flex items-center justify-between gap-4 border-b border-border/40 px-4 py-3 text-sm text-foreground transition-colors last:border-0 hover:bg-accent/40 hover:text-foreground"
              >
                <span>
                  {job.track} · <span className="text-muted-foreground">{job.buildName}</span>
                </span>
                <span className="inline-flex items-center gap-3">
                  <span
                    className={
                      job.pass === null
                        ? "text-muted-foreground"
                        : job.pass
                          ? "vtec-num text-[var(--success)]"
                          : "vtec-num text-[var(--danger)]"
                    }
                  >
                    {job.speedup !== null ? `${job.speedup.toFixed(2)}× ${job.pass ? "pass" : "fail"}` : "running…"}
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    How it was verified <ArrowUpRightIcon className="size-3.5" />
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {me?.verifier ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm tracking-[0.18em] text-muted-foreground uppercase">Your jobs</h2>
          {me.assignments.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/70 bg-card/40 p-8 text-center text-sm text-muted-foreground">
              No jobs yet. You&apos;ll be drawn when someone submits.
            </div>
          ) : (
            me.assignments.map((a) => (
              <Job key={a.id} job={a} sessionId={sessionId!} agentCode={status?.agent?.code} onChange={refresh} />
            ))
          )}
        </section>
      ) : null}
    </>
  );
}

function Job({
  job,
  sessionId,
  agentCode,
  onChange,
}: {
  job: Assignment;
  sessionId: string;
  agentCode?: string;
  onChange: () => void;
}) {
  const sub = job.submission;
  return (
    <div className="animate-in fade-in rounded-xl border border-border/60 bg-card/60 p-5 backdrop-blur-sm duration-300">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium">
            {sub.track} · {sub.buildName}
          </p>
          <p className="vtec-num mt-1 text-xs text-muted-foreground">
            code {sub.buildSha256.slice(0, 16)}… · submitted on {sub.gpu}
          </p>
        </div>
        <span className="flex items-center gap-3">
          <StatusBadge status={sub.status} />
          <Link href={`/verify/${sub.id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
            How it was verified <ArrowUpRightIcon className="size-3.5" />
          </Link>
        </span>
      </div>

      <div className="mt-4">
        {job.status === "assigned" ? (
          <WorldIdButton
            label="Approve with World ID"
            sessionId={sessionId}
            start={() => postJson("/api/verify/approve/start", { sessionId, assignmentId: job.id })}
            confirm={(proof) =>
              postJson("/api/verify/approve/confirm", { sessionId, assignmentId: job.id, idkitResponse: proof })
            }
            onDone={() => {
              toast.success("Approved", { description: "Run the verify command on your laptop." });
              onChange();
            }}
          />
        ) : job.status === "approved" ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">Run this on your laptop. It takes a few minutes.</p>
            <CommandBlock>bun agent/vtec-agent.ts verify {agentCode ?? "<CODE>"}</CommandBlock>
          </div>
        ) : job.status === "committed" ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="inline-block size-2 animate-pulse rounded-full bg-[var(--warning)]" />
            Committed. Waiting for the others ({job.progress.committed}/{job.progress.total} committed).
          </p>
        ) : job.report ? (
          <ReportTable report={job.report} />
        ) : null}
      </div>
    </div>
  );
}

export function ReportTable({ report }: { report: Report }) {
  if (!report.compatible) {
    return <p className="text-sm text-muted-foreground">Couldn&apos;t verify on this machine: {report.reason}. Not counted.</p>;
  }
  const rows: [string, React.ReactNode][] = [
    ["Hardware", report.hardware],
    ["Code hash matches", report.hashMatches ? "✅" : "❌"],
    ["Correctness (same output, random seeds)", report.correct ? "Pass" : "Fail"],
    [`Baseline median (${report.runs} runs)`, `${(report.baselineMedianMs / 1000).toFixed(2)} s`],
    [`Candidate median (${report.runs} runs)`, `${(report.candidateMedianMs / 1000).toFixed(2)} s`],
    ["Noise band", `±${report.noisePct}%`],
    ["Speedup", <strong key="s">{report.speedup.toFixed(2)}×</strong>],
    ["Verdict", report.pass ? "✅ above 1% and noise" : "❌ not proven faster"],
  ];
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-2 rounded-lg border border-border/60 bg-black/20 p-4 text-sm">
      {rows.map(([label, value]) => (
        <React.Fragment key={label}>
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="vtec-num text-right">{value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}
