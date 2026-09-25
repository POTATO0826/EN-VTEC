"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ActivityIcon, ArrowUpRightIcon, PlayIcon } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import {
  SectionLabel,
  StatusBadge,
} from "@/components/vtec/primitives";
import { RUNS, buildPipeline, statusAtTick } from "@/data/vtec";
import { num } from "@/lib/format";
import { saveProject } from "@/lib/projects";
import { ActionCard, FeatureRow, PrimaryAction, RightPanel, StageLayout } from "../shell";
import type { Saga } from "../useSaga";

/** The sweep the saga hands off to. Fixture-backed, so the result page has data. */
function resultRunFor(gpuId: string | undefined) {
  return RUNS.find((run) => run.gpuId === gpuId) ?? RUNS[0];
}

export default function Stage8Run({ saga }: { saga: Saga }) {
  const { state, set, advance } = saga;
  const router = useRouter();
  const gpu = state.agent.gpu;
  const plan = state.plan;
  const target = resultRunFor(gpu?.id);
  const preview = React.useMemo(() => buildPipeline(target), [target]);
  const [starting, setStarting] = React.useState(false);

  const start = React.useCallback(() => {
    setStarting(true);
    saveProject({
      id: state.runId,
      runId: target.id,
      name: `${gpu?.name ?? "GPU"} · ${state.task ?? "sha256"}`,
      gpuName: gpu?.name ?? "GPU",
      task: state.task ?? "sha256",
      createdAt: new Date().toISOString(),
      planHash: state.seal.planHash ?? target.planHash,
      status: "running",
      ensName: state.ens.name ?? undefined,
    });
    set((current) => ({
      ...current,
      stage: 9,
      run: { status: "live", resultId: target.id },
    }));
    router.push(`/results/${target.id}?tab=pipeline&live=1`);
  }, [gpu, router, set, state.ens.name, state.runId, state.seal.planHash, state.task, target]);

  const firstNodes = preview.nodes.slice(0, 6);

  const panel = (
    <RightPanel
      label="Pipeline"
      state={starting ? "starting" : "queued"}
      tone={starting ? "info" : "muted"}
      orb={state.agent.status === "found" ? "found" : "idle"}
      focal={
        <div className="flex w-full flex-col gap-2 text-left">
          <SectionLabel className="mb-1">First nodes</SectionLabel>
          {firstNodes.map((node) => (
            <div
              key={node.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2"
            >
              <span className="truncate text-xs">{node.label}</span>
              <StatusBadge
                status={statusAtTick(node, starting ? node.tick : 0)}
              />
            </div>
          ))}
        </div>
      }
      helper="The plan is already sealed, so every node below is measured against rules nobody can still change."
      pills={[
        `${plan?.variantPool.length ?? 0} variants`,
        `${plan?.batchSizes.length ?? 0} job sizes`,
        "local only",
      ]}
    />
  );

  return (
    <StageLayout
      headline="Start the sweep."
      subhead="Everything from here is measurement. The rules are onchain, the card is fingerprinted, and nothing about either can still be edited."
      panel={panel}
    >
      <ActionCard
        n={1}
        title="What is about to happen"
        why="Each candidate is compiled, checked against the oracle, and only then timed. Anything that fails the check is never given a number, and anything that wins by less than the noise band is rejected."
        state="active"
      >
        <div className="flex flex-col">
          <FeatureRow icon={<ActivityIcon />} title="Runs on your machine">
            The agent compiles and times locally. Nothing is dispatched to us
            and nothing is dispatched to you — GPU VTEC never supplies work.
          </FeatureRow>
          <FeatureRow icon={<PlayIcon />} title="Watchable as it goes">
            The same graph that records the run is the one you watch it on.
          </FeatureRow>
        </div>

        <Separator className="bg-border/40" />

        <div className="flex flex-col gap-1 text-sm text-muted-foreground">
          <span>
            {plan?.variantPool.length ?? 0} variants ×{" "}
            {plan?.batchSizes.length ?? 0} job sizes ×{" "}
            {plan?.runsPerMeasurement ?? 8} runs each
          </span>
          <span className="vtec-num">
            {plan?.batchSizes.map(num).join(" / ")} messages per job
          </span>
        </div>

        <PrimaryAction onClick={start} disabled={starting}>
          {starting ? "Starting…" : "Run the test"}
        </PrimaryAction>
      </ActionCard>

      <ActionCard
        n={2}
        title="Where it goes"
        why="The run has a permanent address from the moment it starts. Close the tab if you like — the same page shows the live run and, later, the audit trail."
        state="future"
      >
        <Link
          href={`/results/${target.id}?tab=pipeline`}
          className="inline-flex w-fit items-center gap-1.5 text-sm text-foreground hover:underline"
          onClick={() => advance()}
        >
          /results/{target.id}
          <ArrowUpRightIcon className="size-3.5" />
        </Link>
      </ActionCard>
    </StageLayout>
  );
}
