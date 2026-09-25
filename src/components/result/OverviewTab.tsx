"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "cn";
import {
  CheckCircle2Icon,
  CpuIcon,
  DownloadIcon,
  ExternalLinkIcon,
  InboxIcon,
  RouteIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  HashChip,
  InfoTip,
  Panel,
  Pill,
  SectionLabel,
  SpecRow,
  SpeedupWithBand,
  StatusBadge,
  StatusDot,
  VariantName,
} from "@/components/vtec/primitives";
import {
  REGISTRY,
  acceptedCandidate,
  gpuFor,
  incomingFor,
  msAt,
  skipReason,
  txUrl,
} from "@/data/vtec";
import type { Candidate, Run, VariantId } from "@/data/vtec/types";
import { VARIANTS, variantName } from "@/data/vtec/variants";
import { bytes, ms, num, pct, speedup as fmtSpeedup, vram } from "@/lib/format";
import { LatencyChart } from "./LatencyChart";

export default function OverviewTab({ run }: { run: Run }) {
  const gpu = gpuFor(run);
  const winner = acceptedCandidate(run);
  const noWinner = run.status === "no-winner";

  return (
    <div className="flex flex-col gap-6">
      <TestPlanStrip run={run} />

      {noWinner ? <NoWinnerBanner run={run} /> : null}

      <KpiRow run={run} winner={winner} />

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel className="xl:col-span-2">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <SectionLabel>Latency vs job size</SectionLabel>
              <h2 className="mt-2 text-base font-medium">
                Where the crossover actually happens.
              </h2>
            </div>
            <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
              Median milliseconds against messages per job, on a log scale with
              the real numbers as labels. The dashed line is the dispatcher: it
              sits on the lowest value that cleared the noise band, and on the
              baseline wherever nothing did.
            </p>
          </div>
          <LatencyChart run={run} />
        </Panel>

        <div className="flex flex-col gap-6">
          <YourGpuPanel run={run} />
          <DispatcherPanel run={run} />
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="flex flex-col gap-6 xl:col-span-2">
          <CandidateTable run={run} />
          <NetworkRegistryPanel run={run} />
        </div>
        <IncomingPanel run={run} />
      </div>

      <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
        Every number on this page comes from the plan shown at the top, which
        was hashed and committed before the first measurement existed. {gpu.name}{" "}
        is one card; nothing here is a claim about any other.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Test plan strip                                                             */
/* -------------------------------------------------------------------------- */

function TestPlanStrip({ run }: { run: Run }) {
  const sizes = run.plan.batchSizes;
  return (
    <Panel className="gap-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <SectionLabel>Test plan</SectionLabel>
          <InfoTip>
            The rules these numbers were produced under. They were hashed and
            committed onchain before any measurement, which is what stops them
            being chosen after the fact.
          </InfoTip>
        </div>
        <span className="flex items-center gap-2 text-xs text-[var(--success)]">
          <CheckCircle2Icon className="size-3.5" />
          committed before the run
        </span>
      </div>

      <div className="grid gap-x-8 gap-y-4 md:grid-cols-3 xl:grid-cols-4">
        <PlanFact label="Task" value={run.task} />
        <PlanFact
          label="Message length"
          value={bytes(run.plan.messageLengthBytes)}
        />
        <PlanFact
          label="Job sizes"
          value={`${num(sizes[0])} to ${num(sizes[sizes.length - 1])} messages`}
        />
        <PlanFact
          label="Baseline"
          value={variantName(run.plan.baselineVariant)}
        />
        <PlanFact
          label="Correctness rule"
          value={`byte-exact against ${run.plan.oracle.name}, ${num(run.plan.oracle.vectors)} vectors`}
        />
        <PlanFact
          label="Runs per measurement"
          value={`${run.plan.runsPerMeasurement}, first discarded, median of ${run.plan.runsPerMeasurement - 1}`}
        />
        <PlanFact
          label="Noise band on this card"
          value={pct(run.noiseBand)}
        />
        <PlanFact
          label="Plan hash"
          value={<HashChip value={run.planHash} lead={12} tail={6} />}
        />
      </div>
    </Panel>
  );
}

function PlanFact({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The third outcome                                                           */
/* -------------------------------------------------------------------------- */

function NoWinnerBanner({ run }: { run: Run }) {
  return (
    <Alert variant="warning">
      <TriangleAlertIcon />
      <AlertTitle>
        No candidate beat this card&apos;s noise band. Baseline stays in use.
      </AlertTitle>
      <AlertDescription>
        <p>
          On {gpuFor(run).name} at {num(run.headlineJobSize)} messages, the
          spread between identical runs is {pct(run.noiseBand)}. The best
          candidate gained less than that, which is not a speedup — it is
          indistinguishable from the machine changing its mind between runs.{" "}
          {variantName(run.plan.baselineVariant)} stays in use.
        </p>
        <p>
          This is a result, not a failure. A system that always finds a winner
          is a system that cannot tell you when there isn&apos;t one.
        </p>
      </AlertDescription>
    </Alert>
  );
}

/* -------------------------------------------------------------------------- */
/* KPI row                                                                     */
/* -------------------------------------------------------------------------- */

function KpiRow({
  run,
  winner,
}: {
  run: Run;
  winner: Candidate | undefined;
}) {
  const variant = (winner?.variant ?? run.plan.baselineVariant) as VariantId;
  const speedupValue = winner?.speedup ?? 1;
  const gain = run.jobsPerHourAfter - run.jobsPerHourBefore;

  return (
    <div className="grid gap-6 md:grid-cols-3">
      <Panel className="gap-3 p-6">
        <div className="flex items-center gap-2">
          <SectionLabel>Winning variant</SectionLabel>
          <InfoTip>
            The candidate that was both correct and faster than the baseline by
            more than this card&apos;s noise band.
          </InfoTip>
        </div>
        <div className="text-2xl font-medium tracking-tight">
          <VariantName id={variant} muted />
        </div>
        <span className="text-xs text-muted-foreground">
          {run.status === "no-winner"
            ? "baseline retained — nothing cleared the band"
            : VARIANTS[variant].detail}
        </span>
      </Panel>

      <Panel className="gap-3 p-6">
        <div className="flex items-center gap-2">
          <SectionLabel>Speedup vs baseline</SectionLabel>
          <InfoTip>
            Shown with the noise band it had to clear. A speedup on its own is
            not a claim, it is a number.
          </InfoTip>
        </div>
        <div className="text-2xl font-medium tracking-tight">
          <SpeedupWithBand value={speedupValue} noiseBand={run.noiseBand} />
        </div>
        <span className="text-xs text-muted-foreground">
          at {num(run.headlineJobSize)} messages per job,{" "}
          {winner?.medianMs !== undefined
            ? ms(winner.medianMs)
            : ms(run.dispatcher.medianMs)}{" "}
          median
        </span>
      </Panel>

      <Panel className="gap-3 p-6">
        <div className="flex items-center gap-2">
          <SectionLabel>Jobs per hour</SectionLabel>
          <InfoTip>
            Derived from the median time per job at this job size. It assumes
            the card does nothing else.
          </InfoTip>
        </div>
        <div className="text-2xl font-medium tracking-tight">
          <span className="vtec-num">{num(run.jobsPerHourAfter)}</span>
        </div>
        <span className="text-xs text-muted-foreground">
          {gain > 0 ? (
            <>
              up from <span className="vtec-num">{num(run.jobsPerHourBefore)}</span>{" "}
              on the baseline
            </>
          ) : (
            <>unchanged — the baseline is still what runs</>
          )}
        </span>
      </Panel>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Your GPU                                                                    */
/* -------------------------------------------------------------------------- */

function YourGpuPanel({ run }: { run: Run }) {
  const gpu = gpuFor(run);
  const [open, setOpen] = React.useState(false);
  const [applied, setApplied] = React.useState(false);
  const variant = (acceptedCandidate(run)?.variant ??
    run.plan.baselineVariant) as VariantId;

  return (
    <Panel className="gap-5 p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <SectionLabel>Your GPU</SectionLabel>
        </div>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <StatusDot tone={gpu.status === "online" ? "success" : "muted"} />
          {gpu.status}
        </span>
      </div>

      <div className="flex items-start gap-3">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/60 text-muted-foreground">
          <CpuIcon className="size-[18px]" />
        </span>
        <div className="flex flex-col gap-0.5">
          <span className="text-base font-medium">{gpu.name}</span>
          <span className="text-xs text-muted-foreground">
            {gpu.smCount} SM · {vram(gpu.vramMb)} · {gpu.l2CacheMb} MB L2 · cc{" "}
            {gpu.computeCapability}
          </span>
        </div>
      </div>

      {applied ? (
        <div className="flex flex-col gap-2 rounded-lg border border-[color-mix(in_oklab,var(--success)_40%,transparent)] bg-[color-mix(in_oklab,var(--success)_8%,transparent)] p-4">
          <span className="flex items-center gap-2 text-sm text-[var(--success)]">
            <CheckCircle2Icon className="size-4" />
            Applied to this node
          </span>
          <code className="vtec-num text-xs break-all text-muted-foreground">
            {run.configPath}
          </code>
          <span className="text-xs leading-relaxed text-muted-foreground">
            The dispatcher reads that file on the next job. Nothing else on the
            machine was changed.
          </span>
        </div>
      ) : (
        <Button
          className="h-11 w-fit rounded-full px-6"
          onClick={() => setOpen(true)}
        >
          <DownloadIcon className="size-4" />
          Apply to my node
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Write this result to the local dispatcher?
            </DialogTitle>
            <DialogDescription>
              {run.status === "no-winner" ? (
                <>
                  Nothing beat the noise band on this card, so this applies{" "}
                  {variantName(run.plan.baselineVariant)} — the baseline. That is
                  still worth writing: it records that the alternatives were
                  measured and did not win here.
                </>
              ) : (
                <>
                  This writes {variantName(variant)} as the choice for{" "}
                  {gpu.name} at {num(run.headlineJobSize)} messages per job. The
                  dispatcher picks per job, so other job sizes keep whatever the
                  registry says for them.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <code className="vtec-num rounded-lg border border-border/60 px-3 py-2.5 text-xs break-all">
            {run.configPath}
          </code>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" className="rounded-full">
                Cancel
              </Button>
            </DialogClose>
            <Button
              className="h-11 rounded-full px-6"
              onClick={() => {
                setApplied(true);
                setOpen(false);
              }}
            >
              Write the config
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Dispatcher                                                                  */
/* -------------------------------------------------------------------------- */

function DispatcherPanel({ run }: { run: Run }) {
  const dispatch = run.dispatcher;
  return (
    <Panel className="gap-5 p-6">
      <div className="flex items-center gap-2">
        <RouteIcon className="size-4 text-muted-foreground" />
        <SectionLabel>Dispatcher</SectionLabel>
        <InfoTip>
          The runtime piece that reads the registry and picks a variant per job.
        </InfoTip>
      </div>

      <div className="flex flex-col">
        <SpecRow label="Current job size">
          <span className="vtec-num">{num(run.headlineJobSize)} messages</span>
        </SpecRow>
        <SpecRow label="Chosen">
          <VariantName id={dispatch.variant as VariantId} muted />
        </SpecRow>
        <SpecRow label="Median">
          <span className="vtec-num">{ms(dispatch.medianMs)}</span>
        </SpecRow>
        <SpecRow label="Against baseline">
          <SpeedupWithBand
            value={dispatch.speedup}
            noiseBand={dispatch.noiseBand}
          />
        </SpecRow>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-muted/20 p-4">
        <SectionLabel>Why this one</SectionLabel>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {dispatch.reason}
        </p>
      </div>

      <a
        href={txUrl(run.chain, dispatch.attestationTx)}
        target="_blank"
        rel="noreferrer"
        className="vtec-num inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        attestation {dispatch.attestationTx.slice(0, 12)}…
        <ExternalLinkIcon className="size-3" />
      </a>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Incoming from your prover                                                   */
/* -------------------------------------------------------------------------- */

function IncomingPanel({ run }: { run: Run }) {
  const jobs = React.useMemo(() => incomingFor(run), [run]);

  return (
    <Panel className="gap-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <InboxIcon className="size-4 text-muted-foreground" />
          <SectionLabel>Incoming from your prover</SectionLabel>
        </div>
        <Badge
          variant="outline"
          className="rounded-md border-border/60 px-2 py-0.5 text-[11px] font-normal text-muted-foreground"
        >
          simulated in this demo
        </Badge>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Jobs arrive from your own pipeline. GPU VTEC never supplies work and
        never routes it — it only decides which build of the kernel runs when a
        job of this size shows up.
      </p>

      <div className="flex flex-col gap-2">
        {jobs.map((job) => (
          <div
            key={job.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2.5"
          >
            <span className="vtec-num text-xs">
              {num(job.jobSize)} messages
            </span>
            <span className="flex items-center gap-3 text-xs">
              <VariantName id={job.variant} muted className="text-xs" />
              <span className="vtec-num text-muted-foreground">
                {ms(job.medianMs)}
              </span>
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Candidates                                                                  */
/* -------------------------------------------------------------------------- */

function CandidateTable({ run }: { run: Run }) {
  const baselineMs = msAt(
    run,
    run.plan.baselineVariant,
    run.plan.batchSizes.indexOf(run.headlineJobSize),
  );

  return (
    <Panel className="gap-5 p-6">
      <div>
        <SectionLabel>Candidates</SectionLabel>
        <h2 className="mt-2 text-base font-medium">
          What was rejected, and why.
        </h2>
        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted-foreground">
          The rejections are the reason the accepted number is believable. A
          candidate that produced the wrong answer was never timed at all.
        </p>
      </div>

      <Table>
        <TableHeader>
          <TableRow className="border-border/60 hover:bg-transparent">
            <TableHead>Candidate</TableHead>
            <TableHead>Correct</TableHead>
            <TableHead>Median</TableHead>
            <TableHead>Speedup</TableHead>
            <TableHead>vs noise band</TableHead>
            <TableHead>Verdict</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow className="border-border/40 hover:bg-transparent">
            <TableCell>
              <VariantName id={run.plan.baselineVariant} muted />
            </TableCell>
            <TableCell className="text-muted-foreground">yes</TableCell>
            <TableCell className="vtec-num">
              {baselineMs !== null ? ms(baselineMs) : "—"}
            </TableCell>
            <TableCell className="vtec-num text-muted-foreground">
              1.00×
            </TableCell>
            <TableCell className="text-muted-foreground">
              defines the band ({pct(run.noiseBand)})
            </TableCell>
            <TableCell>
              <StatusBadge status="passed" />
            </TableCell>
          </TableRow>

          {run.candidates.map((candidate) => (
            <TableRow
              key={candidate.variant}
              className={cn(
                "border-border/40 hover:bg-transparent",
                candidate.verdict === "failed" && "opacity-80",
              )}
            >
              <TableCell>
                <VariantName id={candidate.variant} muted />
              </TableCell>
              <TableCell
                className={
                  candidate.correct
                    ? "text-muted-foreground"
                    : "text-[var(--danger)]"
                }
              >
                {candidate.correct ? "yes" : "no"}
              </TableCell>
              <TableCell className="vtec-num">
                {candidate.medianMs !== undefined
                  ? ms(candidate.medianMs)
                  : "never timed"}
              </TableCell>
              <TableCell className="vtec-num">
                {candidate.speedup !== undefined
                  ? fmtSpeedup(candidate.speedup)
                  : "—"}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {candidate.gainPct !== undefined
                  ? `${candidate.gainPct > 0 ? "+" : ""}${candidate.gainPct.toFixed(1)}% against ${pct(run.noiseBand)}`
                  : "not measured"}
              </TableCell>
              <TableCell>
                <StatusBadge
                  status={
                    candidate.verdict === "accepted"
                      ? "accepted"
                      : candidate.verdict === "failed"
                        ? "failed"
                        : candidate.verdict === "skipped"
                          ? "skipped"
                          : "rejected"
                  }
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="flex flex-col gap-2">
        {run.candidates.map((candidate) => (
          <div
            key={`${candidate.variant}-reason`}
            className="flex flex-wrap items-baseline gap-2 text-xs"
          >
            <VariantName
              id={candidate.variant}
              muted
              className="text-xs text-muted-foreground"
            />
            <span className="text-muted-foreground">— {candidate.reason}</span>
          </div>
        ))}
        {run.skipped.map((entry) => (
          <div
            key={entry.jobSize}
            className="flex flex-wrap items-baseline gap-2 text-xs"
          >
            <span className="vtec-num text-muted-foreground">
              {num(entry.jobSize)} messages
            </span>
            <span className="text-muted-foreground">
              — skipped: {entry.reason}
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Network registry                                                            */
/* -------------------------------------------------------------------------- */

function NetworkRegistryPanel({ run }: { run: Run }) {
  const others = REGISTRY.filter((entry) => entry.runId !== run.id);
  const byGpu = React.useMemo(() => {
    const map = new Map<string, typeof others>();
    for (const entry of others) {
      const list = map.get(entry.gpu) ?? [];
      list.push(entry);
      map.set(entry.gpu, list);
    }
    return [...map.entries()];
  }, [others]);

  return (
    <Panel className="gap-5 p-6">
      <div>
        <SectionLabel>Network registry</SectionLabel>
        <h2 className="mt-2 text-base font-medium">
          What other cards decided.
        </h2>
      </div>

      <div className="flex flex-col gap-4">
        {byGpu.map(([gpuName, entries]) => (
          <div key={gpuName} className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm">{gpuName}</span>
              <a
                href={txUrl(run.chain, entries[0].tx)}
                target="_blank"
                rel="noreferrer"
                className="vtec-num inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                {entries[0].tx.slice(0, 10)}…
                <ExternalLinkIcon className="size-3" />
              </a>
            </div>
            <div className="flex flex-wrap gap-2">
              {entries.map((entry) => (
                <Link
                  key={`${entry.runId}-${entry.jobSize}`}
                  href={`/results/${entry.runId}`}
                  className="inline-flex items-center gap-2 rounded-md border border-border/60 px-3 py-1.5 text-xs transition-colors hover:border-border hover:bg-accent/40"
                >
                  <span className="vtec-num text-muted-foreground">
                    {num(entry.jobSize)}
                  </span>
                  <VariantName
                    id={entry.variant as VariantId}
                    muted
                    className="text-xs"
                  />
                  <span className="vtec-num">
                    {entry.baselineRetained ? "—" : fmtSpeedup(entry.speedup)}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>

      <Separator className="bg-border/40" />
      <div className="flex flex-wrap gap-2">
        <Pill>{REGISTRY.length} entries</Pill>
        <Pill>one per card, per job size</Pill>
        <Pill>
          {skipReason(run, run.plan.batchSizes[run.plan.batchSizes.length - 1])
            ? "some sizes not run"
            : "all sizes run here"}
        </Pill>
      </div>
    </Panel>
  );
}
