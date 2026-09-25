"use client";

import Link from "next/link";
import { ArrowUpRightIcon, RadioIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/vtec/primitives";
import { RUNS } from "@/data/vtec";
import { ActionCard, RightPanel, StageLayout } from "../shell";
import type { Saga } from "../useSaga";

export default function Stage9Live({ saga }: { saga: Saga }) {
  const { state, reset } = saga;
  const resultId = state.run.resultId ?? RUNS[0].id;

  const panel = (
    <RightPanel
      label="Run"
      state={state.run.status === "live" ? "live" : "idle"}
      tone={state.run.status === "live" ? "success" : "muted"}
      orb={state.agent.status === "found" ? "found" : "idle"}
      focal={
        <div className="flex flex-col items-center gap-3">
          <RadioIcon className="size-10 text-[var(--success)]" />
          <span className="text-sm">The sweep is running</span>
        </div>
      }
      helper="This is a destination, not a step. Everything from here is on the result page."
      pills={["live", "local", "sealed plan"]}
    />
  );

  return (
    <StageLayout
      headline="The run is live."
      subhead="There is nothing left to decide. The result page is both the live monitor and, once it finishes, the permanent record."
      panel={panel}
    >
      <ActionCard
        n={1}
        title="Watch it"
        why="The pipeline view is driven by the same nodes during the run and afterwards, so what you are watching now is the audit trail being written."
        state="active"
      >
        <SectionLabel>Result</SectionLabel>
        <Link
          href={`/results/${resultId}?tab=pipeline`}
          className="inline-flex w-fit items-center gap-1.5 text-sm text-foreground hover:underline"
        >
          /results/{resultId}
          <ArrowUpRightIcon className="size-3.5" />
        </Link>
        <div className="flex flex-wrap gap-3 pt-2">
          <Button asChild className="h-11 rounded-full px-6">
            <Link href={`/results/${resultId}?tab=pipeline&live=1`}>
              Open the live run
            </Link>
          </Button>
          <Button
            variant="ghost"
            className="h-11 rounded-full px-6 text-muted-foreground"
            onClick={reset}
          >
            Start another project
          </Button>
        </div>
      </ActionCard>
    </StageLayout>
  );
}
