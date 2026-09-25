"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "cn";
import { ArrowLeftIcon, ExternalLinkIcon } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  HashChip,
  Panel,
  ResultStatusBadge,
  SectionLabel,
} from "@/components/vtec/primitives";
import { RUNS, ensUrl, gpuFor, runById } from "@/data/vtec";
import { num, shortDate } from "@/lib/format";
import OverviewTab from "./OverviewTab";
import PipelineTab from "./PipelineTab";
import PlanTab from "./PlanTab";

const TABS = ["overview", "pipeline", "plan"] as const;
type TabId = (typeof TABS)[number];

export default function ResultView({
  id,
  initialTab,
  live = false,
}: {
  id: string;
  initialTab?: string;
  live?: boolean;
}) {
  const run = runById(id);
  const [tab, setTab] = React.useState<TabId>(() =>
    TABS.includes(initialTab as TabId) ? (initialTab as TabId) : "overview",
  );

  // Keep the URL honest without a server round trip on every tab change.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState(null, "", url.toString());
  }, [tab]);

  if (!run) {
    return (
      <main className="mx-auto w-full max-w-[1500px] px-6 py-10 md:px-10 md:py-14">
        <Panel className="max-w-2xl gap-4">
          <SectionLabel>Not found</SectionLabel>
          <h1 className="text-2xl font-medium tracking-tight">
            No result with that id.
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Results are addressed permanently, so a missing one usually means a
            mistyped link. Here is everything recorded so far:
          </p>
          <ul className="flex flex-col gap-2">
            {RUNS.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/results/${item.id}`}
                  className="vtec-num text-sm text-muted-foreground hover:text-foreground"
                >
                  /results/{item.id}
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </main>
    );
  }

  const gpu = gpuFor(run);
  const isCanvas = tab === "pipeline";

  return (
    <TooltipProvider>
      {/* The pipeline is a canvas, not a document: it gets the whole width and
          a tighter gutter, so the graph is not reading through a letterbox. */}
      <main
        className={cn(
          "mx-auto w-full px-6 md:py-14",
          isCanvas
            ? "max-w-none py-6 md:px-6 md:py-8"
            : "max-w-[1500px] py-10 md:px-10",
        )}
      >
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" />
          Registry
        </Link>

        <header className="mt-6 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <SectionLabel>Result</SectionLabel>
              <ResultStatusBadge status={run.status} />
              <span className="text-xs text-muted-foreground">
                {shortDate(run.createdAt)}
              </span>
            </div>
            {/* The canvas needs the vertical room more than the prose does, so
                the pipeline tab keeps the title and drops the essay. */}
            <h1
              className={cn(
                "mt-3 font-medium tracking-tight",
                isCanvas ? "text-xl md:text-2xl" : "text-3xl md:text-4xl",
              )}
            >
              {gpu.name} · {run.task} · {num(run.headlineJobSize)} messages per
              job.
            </h1>
            {isCanvas ? null : (
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                {run.status === "no-winner"
                  ? "Nothing on this card beat the baseline by more than the run-to-run noise, so the baseline stays in use. Every rejection and its reason is below."
                  : "Measured under rules that were hashed and committed before the first run. Every candidate, including the rejected ones, is below."}
              </p>
            )}
          </div>

          <div className="flex flex-col items-start gap-2 md:items-end">
            <HashChip value={run.planHash} lead={12} tail={8} />
            {run.ensName ? (
              <a
                href={ensUrl(run.ensName)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                {run.ensName}
                <ExternalLinkIcon className="size-3" />
              </a>
            ) : null}
          </div>
        </header>

        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as TabId)}
          className={cn("gap-6", isCanvas ? "mt-6" : "mt-10")}
        >
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
            <TabsTrigger value="plan">Plan and proof</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <OverviewTab run={run} />
          </TabsContent>
          <TabsContent value="pipeline">
            <PipelineTab run={run} live={live} />
          </TabsContent>
          <TabsContent value="plan">
            <PlanTab run={run} />
          </TabsContent>
        </Tabs>
      </main>
    </TooltipProvider>
  );
}
