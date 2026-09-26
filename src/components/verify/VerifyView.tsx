"use client";

import * as React from "react";
import Link from "next/link";
import { DicesIcon, EyeOffIcon, LaptopIcon, ScanFaceIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusBadge, type Status } from "@/components/ui/status-badge";
import { PageTitle } from "@/components/ui/step";
import { CommandBlock } from "@/components/tuners/TrackView";
import WorldIdButton, { postJson } from "@/components/world/WorldIdButton";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import SlushConnect from "@/components/sui/SlushConnect";
import { useSessionId, useSessionStatus } from "@/lib/session";
import { SUI } from "@/lib/sui-tx";

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

const HOW = [
  { icon: <DicesIcon />, title: "Drawn at random", text: "Up to 5 verifiers per submission, picked with Sui's on-chain randomness." },
  { icon: <ScanFaceIcon />, title: "Approve with World ID", text: "A fresh World ID check for every job, so each verifier is one real person." },
  { icon: <LaptopIcon />, title: "Your agent runs it", text: "Checks your hardware can run it, then times baseline vs candidate on your laptop." },
  { icon: <EyeOffIcon />, title: "Commit, then reveal", text: "Results stay hidden until all verifiers commit, then the majority decides. Each earns a share of the fee." },
];

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

  const account = useCurrentAccount();
  const join = async () => {
    const res = await postJson("/api/verify/join", { sessionId, address: account?.address });
    if (res.ok) {
      toast.success("You're in the verifier pool", { description: "You'll be drawn for new submissions." });
      refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error("Couldn't join", { description: data.detail ?? "You need a World ID seat first." });
    }
  };

  return (
    <>
      <PageTitle
        title="Verify"
        subtitle="Nothing reaches the Kernel Code Efficiency Ranking until independent, real people re-run it on their own hardware."
      />

      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {HOW.map((step, i) => (
          <div
            key={step.title}
            className="animate-in fade-in slide-in-from-bottom-2 fill-mode-both rounded-xl border border-border/60 bg-card/60 p-4 backdrop-blur-sm duration-500"
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <span className="text-muted-foreground [&>svg]:size-4">{step.icon}</span>
            <p className="mt-3 text-sm font-medium">{step.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{step.text}</p>
          </div>
        ))}
      </div>

      <section className="mb-8 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border/60 bg-card/60 p-5 backdrop-blur-sm">
        <div>
          <p className="font-medium">{me?.verifier ? "You're a verifier" : "Join the verifier pool"}</p>
          <p className="text-sm text-muted-foreground">
            {me?.verifier
              ? `Reputation ${me.verifier.reputation >= 0 ? "+" : ""}${me.verifier.reputation} · ${me.poolSize} verifier${me.poolSize === 1 ? "" : "s"} in the pool`
              : `Verifiers earn a share of each ${SUI.feeSui} SUI process fee. Needs World ID, a connected agent and Slush for payouts. ${me?.poolSize ?? 0} in the pool now.`}
          </p>
        </div>
        {me?.verifier ? null : status?.seat && status.agent ? (
          account ? (
            <div className="flex flex-wrap items-center gap-2">
              <SlushConnect />
              <Button onClick={join} className="rounded-full px-5">
                Join the pool
              </Button>
            </div>
          ) : (
            <SlushConnect label="Connect Slush to join" />
          )
        ) : (
          <Button asChild variant="outline" className="rounded-full">
            <Link href="/">{status?.seat ? "Connect your agent" : "Verify with World ID first"}</Link>
          </Button>
        )}
      </section>

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
            While the pool is small, the platform runs the same verifier agent on its own machine.
          </p>
          <div className="overflow-hidden rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm">
            {me.harness.jobs.map((job) => (
              <Link
                key={job.submissionId}
                href={`/tuners/${job.trackId}#${job.submissionId}`}
                className="flex items-center justify-between gap-4 border-b border-border/40 px-4 py-3 text-sm text-foreground transition-colors last:border-0 hover:bg-accent/40 hover:text-foreground"
              >
                <span>
                  {job.track} · <span className="text-muted-foreground">{job.buildName}</span>
                </span>
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
        <StatusBadge status={sub.status} />
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
