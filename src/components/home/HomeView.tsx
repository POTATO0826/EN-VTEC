"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpRightIcon,
  CpuIcon,
  ExternalLinkIcon,
  GaugeIcon,
  LayersIcon,
  PlusIcon,
  ShieldCheckIcon,
  Trash2Icon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  HashChip,
  InfoTip,
  Panel,
  Pill,
  ResultStatusBadge,
  SectionLabel,
  StatusDot,
  VariantName,
} from "@/components/vtec/primitives";
import {
  GPUS,
  RUNS,
  SUMMARY,
  acceptedCandidate,
  bucketSizes,
  completedSizes,
  gpuFor,
  registryForGpu,
  runsForGpu,
  skipReason,
  txUrl,
} from "@/data/vtec";
import type { RegistryEntry, Run, VariantId } from "@/data/vtec/types";
import { num, pct, shortDate, speedup as fmtSpeedup, vram } from "@/lib/format";
import { removeProject, useProjects } from "@/lib/projects";
import SystemStatus from "@/components/system/SystemStatus";

export default function HomeView() {
  const projects = useProjects();

  return (
    <TooltipProvider>
      <main className="mx-auto w-full max-w-[1400px] px-6 py-10 md:px-10 md:py-14">
        <PageHeader />
        <div className="mt-10 flex flex-col gap-14">
          <SummaryStrip />
          <SystemStatus />
          <RecentResults />
          <GpuRegistryGrid />
          <YourProjects projects={projects} />
        </div>
        <Footnote />
      </main>
    </TooltipProvider>
  );
}

/* -------------------------------------------------------------------------- */

function PageHeader() {
  return (
    <header className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
      <div className="max-w-2xl">
        <h1 className="text-4xl font-medium tracking-tight md:text-5xl">
          Which build of your kernel is actually fastest on this card.
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
          GPU VTEC measures every candidate on the specific card it will run on,
          proves the measurement was not faked, and applies the winner. Browse
          everything below without a wallet, an account, or a GPU.
        </p>
      </div>
      <Button
        asChild
        className="h-11 shrink-0 rounded-full px-6 text-sm font-medium"
      >
        <Link href="/projects/new">
          <PlusIcon className="size-4" />
          New project
        </Link>
      </Button>
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/* a. Summary strip                                                            */
/* -------------------------------------------------------------------------- */

function SummaryTile({
  label,
  help,
  value,
  delta,
  icon,
}: {
  label: string;
  help: string;
  value: React.ReactNode;
  delta: string;
  icon?: React.ReactNode;
}) {
  return (
    <Panel className="gap-4 p-6">
      <div className="flex items-center gap-2">
        {icon}
        <SectionLabel>{label}</SectionLabel>
        <InfoTip>{help}</InfoTip>
      </div>
      <div className="text-3xl font-medium tracking-tight">{value}</div>
      <Badge
        variant="outline"
        className="w-fit rounded-md border-border/60 px-2 py-0.5 text-[11px] font-normal text-muted-foreground"
      >
        {delta}
      </Badge>
    </Panel>
  );
}

function SummaryStrip() {
  return (
    <section aria-labelledby="summary-heading">
      <h2 id="summary-heading" className="sr-only">
        Registry summary
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryTile
          label="Noise band on this card"
          help="How much the same code's timing varies run to run on this machine. A candidate has to beat the baseline by more than this to be accepted at all."
          value={pct(RUNS[0].noiseBand)}
          delta={`${RUNS.length} sweep recorded`}
          icon={<CpuIcon className="size-4 text-muted-foreground" />}
        />
        <SummaryTile
          label="Verified results"
          help="One entry per job size, each with a plan hash committed before the run and a reveal transaction after it."
          value={SUMMARY.verifiedResults}
          delta={`${SUMMARY.noWinnerCount} recorded with no winner`}
          icon={<ShieldCheckIcon className="size-4 text-muted-foreground" />}
        />
        <SummaryTile
          label="Tasks covered"
          help="sha256 today. keccak256 needs its correctness oracle and padding vectors pinned down before anything can be timed against it."
          value={SUMMARY.tasksCovered}
          delta="sha256 · keccak256 coming soon"
          icon={<LayersIcon className="size-4 text-muted-foreground" />}
        />
        <SummaryTile
          label="Best speedup on record"
          help="The largest accepted gain against a baseline, on one card at one job size. It is not a claim about any other card."
          value={
            <span className="flex flex-col gap-1">
              <span className="vtec-num">
                {fmtSpeedup(SUMMARY.best.speedup)}
              </span>
              <span className="text-sm font-normal text-muted-foreground">
                {SUMMARY.best.gpu}, {num(SUMMARY.best.jobSize)} messages
              </span>
            </span>
          }
          delta={`cleared its card's noise band`}
          icon={<GaugeIcon className="size-4 text-muted-foreground" />}
        />
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* b. Recent results                                                           */
/* -------------------------------------------------------------------------- */

function winnerFor(run: Run): { variant: VariantId; speedup: number } {
  const accepted = acceptedCandidate(run);
  if (accepted) {
    return {
      variant: accepted.variant,
      speedup: accepted.speedup ?? 1,
    };
  }
  return { variant: run.plan.baselineVariant, speedup: 1 };
}

function RecentResults() {
  const router = useRouter();
  const sorted = React.useMemo(
    () =>
      [...RUNS].sort(
        (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt),
      ),
    [],
  );

  return (
    <section aria-labelledby="recent-heading" className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-6">
        <div>
          <SectionLabel>Recent results</SectionLabel>
          <h2
            id="recent-heading"
            className="mt-2 text-xl font-medium tracking-tight"
          >
            Completed sweeps, newest first.
          </h2>
        </div>
      </div>
      <Panel className="p-0 md:p-0">
        <Table>
          <TableHeader>
            <TableRow className="border-border/60 hover:bg-transparent">
              <TableHead className="pl-6">GPU</TableHead>
              <TableHead>Task</TableHead>
              <TableHead>Job size</TableHead>
              <TableHead>Winning variant</TableHead>
              <TableHead>Speedup</TableHead>
              <TableHead>Noise band</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="pr-6 text-right">Reveal tx</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((run) => {
              const winner = winnerFor(run);
              const noWinner = run.status === "no-winner";
              return (
                <TableRow
                  key={run.id}
                  tabIndex={0}
                  role="link"
                  onClick={() => router.push(`/results/${run.id}`)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      router.push(`/results/${run.id}`);
                    }
                  }}
                  className="cursor-pointer border-border/40"
                >
                  <TableCell className="pl-6 font-medium whitespace-nowrap">
                    {gpuFor(run).name}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {run.task}
                  </TableCell>
                  <TableCell className="vtec-num whitespace-nowrap">
                    {num(run.headlineJobSize)} messages
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {noWinner ? (
                      <span className="flex items-center gap-2">
                        <VariantName id={winner.variant} muted />
                        <span className="text-xs text-muted-foreground">
                          (baseline retained)
                        </span>
                      </span>
                    ) : (
                      <VariantName id={winner.variant} muted />
                    )}
                  </TableCell>
                  <TableCell className="vtec-num whitespace-nowrap">
                    {fmtSpeedup(winner.speedup)}
                  </TableCell>
                  <TableCell className="vtec-num whitespace-nowrap text-muted-foreground">
                    {run.noiseBand.toFixed(1)}%
                  </TableCell>
                  <TableCell>
                    <ResultStatusBadge status={run.status} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {shortDate(run.createdAt)}
                  </TableCell>
                  <TableCell className="pr-6 text-right">
                    <a
                      href={txUrl(run.chain, run.revealTx)}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(event) => event.stopPropagation()}
                      className="vtec-num inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                    >
                      {run.revealTx.slice(0, 10)}…
                      <ExternalLinkIcon className="size-3" />
                    </a>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Panel>
      <p className="text-sm text-muted-foreground">
        Every speedup above is against this card&apos;s own baseline, and only
        counts because it is larger than this card&apos;s measured noise band. A
        sweep that ends with no winner is a result too, and is recorded the same
        way.
      </p>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* c. GPU registry                                                             */
/* -------------------------------------------------------------------------- */

function RegistryPill({ entry }: { entry: RegistryEntry }) {
  return (
    <Link
      href={`/results/${entry.runId}`}
      className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2 text-xs transition-colors hover:border-border hover:bg-accent/40"
    >
      <span className="vtec-num text-muted-foreground">
        {num(entry.jobSize)}
      </span>
      <span className="flex items-center gap-2 text-right">
        <VariantName id={entry.variant as VariantId} muted />
        <span className="vtec-num">
          {entry.baselineRetained ? "—" : fmtSpeedup(entry.speedup)}
        </span>
      </span>
    </Link>
  );
}

function GpuRegistryGrid() {
  const cards = GPUS.filter((gpu) => runsForGpu(gpu.id).length > 0);

  return (
    <section aria-labelledby="registry-heading" className="flex flex-col gap-4">
      <div>
        <SectionLabel>GPU registry</SectionLabel>
        <h2
          id="registry-heading"
          className="mt-2 text-xl font-medium tracking-tight"
        >
          The fastest code changes with the job.
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          This is the whole argument. If one variant were fastest at every size,
          there would be nothing to record, nothing to dispatch, and nothing to
          verify. Below, the winner changes with the job size on this card.
          Releases are scoped to the hardware and workload they were measured on;
          other machines contribute their own.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((gpu) => {
          const runs = runsForGpu(gpu.id);
          const entries = registryForGpu(gpu.id);
          const run = runs[0];
          const declared = bucketSizes(run);
          const notRun = run.plan.batchSizes.filter(
            (size) => !completedSizes(run).includes(size),
          );
          return (
            <Panel key={gpu.id} className="gap-5 p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-base font-medium">{gpu.name}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {gpu.smCount} SM · {vram(gpu.vramMb)} VRAM ·{" "}
                    {gpu.l2CacheMb} MB L2
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    power limit{" "}
                    {gpu.powerLimitW === null ? (
                      <span className="text-[var(--warning)]">not recorded</span>
                    ) : (
                      <span className="vtec-num">{gpu.powerLimitW} W</span>
                    )}
                    {gpu.powerMode ? ` · ${gpu.powerMode}` : null}
                  </p>
                </div>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <StatusDot
                    tone={gpu.status === "online" ? "success" : "muted"}
                  />
                  {gpu.status}
                </span>
              </div>

              <div className="flex flex-wrap gap-2">
                <Pill>cc {gpu.computeCapability}</Pill>
                <Pill>
                  {runs.length} {runs.length === 1 ? "task" : "tasks"} with
                  results
                </Pill>
                <Pill>driver {gpu.driverVersion}</Pill>
              </div>

              <div className="flex flex-col gap-1.5">
                <SectionLabel className="mb-1">
                  Winner by job size
                </SectionLabel>
                {entries.map((entry) => (
                  <RegistryPill
                    key={`${entry.runId}-${entry.jobSize}`}
                    entry={entry}
                  />
                ))}
                {declared.length < 3 && notRun.length > 0 ? (
                  <span className="flex items-center justify-between gap-3 rounded-md border border-dashed border-border/60 px-3 py-2 text-xs text-muted-foreground">
                    <span className="vtec-num">{num(notRun[0])}</span>
                    <span className="text-right">
                      not run — {skipReason(run, notRun[0])}
                    </span>
                  </span>
                ) : null}
              </div>

              <Separator className="bg-border/40" />

              <div className="flex items-center justify-between gap-4">
                <span className="text-xs text-muted-foreground">
                  {run.status === "no-winner"
                    ? "Baseline retained on this card"
                    : `Noise band ${run.noiseBand.toFixed(1)}% on this card`}
                </span>
                <Link
                  href={`/results/${run.id}`}
                  className="inline-flex items-center gap-1 text-xs text-foreground hover:underline"
                >
                  Open result
                  <ArrowUpRightIcon className="size-3" />
                </Link>
              </div>
            </Panel>
          );
        })}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* d. Your projects                                                            */
/* -------------------------------------------------------------------------- */

function YourProjects({
  projects,
}: {
  projects: ReturnType<typeof useProjects>;
}) {
  return (
    <section aria-labelledby="projects-heading" className="flex flex-col gap-4">
      <div>
        <SectionLabel>Your projects</SectionLabel>
        <h2
          id="projects-heading"
          className="mt-2 text-xl font-medium tracking-tight"
        >
          Everything you have started on this machine.
        </h2>
      </div>

      {projects.length === 0 ? (
        <Panel className="items-start gap-4">
          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
            Nothing here yet. A project pins down the rules for one task on one
            card, seals them onchain, and then runs the sweep. Results stay on
            this machine until you publish them.
          </p>
          <Button asChild className="h-11 rounded-full px-6">
            <Link href="/projects/new">
              <PlusIcon className="size-4" />
              New project
            </Link>
          </Button>
        </Panel>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <Panel key={project.id} className="gap-4 p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-base font-medium">{project.name}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {project.gpuName} · {project.task} ·{" "}
                    {shortDate(project.createdAt)}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${project.name} from this browser`}
                  onClick={() => removeProject(project.id)}
                  className="text-muted-foreground/70 transition-colors hover:text-foreground"
                >
                  <Trash2Icon className="size-4" />
                </button>
              </div>
              <HashChip value={project.planHash} copyable={false} />
              <div className="flex items-center justify-between gap-4">
                {project.ensName ? (
                  <Pill>{project.ensName}</Pill>
                ) : (
                  <Pill>not published</Pill>
                )}
                <Link
                  href={`/results/${project.runId}`}
                  className="inline-flex items-center gap-1 text-xs text-foreground hover:underline"
                >
                  Open
                  <ArrowUpRightIcon className="size-3" />
                </Link>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </section>
  );
}

function Footnote() {
  return (
    <p className="mt-16 max-w-3xl text-xs leading-relaxed text-muted-foreground">
      Every number on this page is a typed fixture. There is no GPU detection,
      no benchmark execution, and no chain call in this build — the shapes are
      the ones the backend will have to produce. GPU VTEC never supplies or
      routes work; jobs arrive from your own prover.
    </p>
  );
}
