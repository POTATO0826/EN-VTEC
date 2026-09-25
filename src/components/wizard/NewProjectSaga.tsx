"use client";

import { ExternalLinkIcon, LockIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  HashChip,
  SectionLabel,
  SpecRow,
} from "@/components/vtec/primitives";
import { txUrl } from "@/data/vtec";
import { bytes, num } from "@/lib/format";
import { planSentences } from "@/lib/plan";
import { PrimaryAction, RightPanel, Rail, SagaHeader, StageLayout } from "./shell";
import { useSaga, type Saga } from "./useSaga";
import Stage1Agent from "./stages/Stage1Agent";
import Stage2Task from "./stages/Stage2Task";
import Stage3Plan from "./stages/Stage3Plan";
import Stage4Identity from "./stages/Stage4Identity";
import Stage5Seal from "./stages/Stage5Seal";
import Stage6Name from "./stages/Stage6Name";
import Stage7Review from "./stages/Stage7Review";
import Stage8Run from "./stages/Stage8Run";
import Stage9Live from "./stages/Stage9Live";

export default function NewProjectSaga() {
  const saga = useSaga();
  const { state, loading, goTo } = saga;

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-[1500px] px-6 py-10 md:px-10 md:py-14">
        <Skeleton className="h-4 w-48" />
        <div className="vtec-saga-grid mt-10">
          <Skeleton className="h-96 w-full rounded-xl" />
          <Skeleton className="h-96 w-full rounded-xl" />
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
      </main>
    );
  }

  return (
    <TooltipProvider>
      <main className="mx-auto w-full max-w-[1500px] px-6 py-10 md:px-10 md:py-14">
        <SagaHeader stage={state.stage} />
        <div className="vtec-saga-grid">
          <Rail state={state} goTo={goTo} />
          <StageBody saga={saga} />
        </div>
      </main>
    </TooltipProvider>
  );
}

function StageBody({ saga }: { saga: Saga }) {
  const { state } = saga;

  // Once the plan is sealed, everything that fed it is read-only for good.
  if (state.seal.status === "sealed" && state.stage <= 3) {
    return <LockedStage saga={saga} />;
  }

  switch (state.stage) {
    case 1:
      return <Stage1Agent saga={saga} />;
    case 2:
      return <Stage2Task saga={saga} />;
    case 3:
      return <Stage3Plan saga={saga} />;
    case 4:
      return <Stage4Identity saga={saga} />;
    case 5:
      return <Stage5Seal saga={saga} />;
    case 6:
      return <Stage6Name saga={saga} />;
    case 7:
      return <Stage7Review saga={saga} />;
    case 8:
      return <Stage8Run saga={saga} />;
    default:
      return <Stage9Live saga={saga} />;
  }
}

/** Stages 1 to 3 after sealing: the same facts, with nothing left to change. */
function LockedStage({ saga }: { saga: Saga }) {
  const { state, goTo } = saga;
  const { agent, plan, seal, task } = state;
  const gpu = agent.gpu;
  const sentences = plan ? planSentences(plan) : [];

  const panel = (
    <RightPanel
      label="Sealed"
      state="locked"
      tone="success"
      orb={agent.status === "found" ? "found" : "idle"}
      focal={
        <div className="flex flex-col items-center gap-4">
          <span className="inline-flex size-20 items-center justify-center rounded-full border border-[color-mix(in_oklab,var(--success)_45%,transparent)] text-[var(--success)]">
            <LockIcon className="size-7" />
          </span>
          {seal.planHash ? (
            <code className="vtec-num px-2 text-xs leading-relaxed break-all text-muted-foreground">
              {seal.planHash}
            </code>
          ) : null}
        </div>
      }
      helper="Sealed before the first measurement existed. Nothing here can be edited."
      pills={[seal.chain, "read-only", "committed"]}
    />
  );

  return (
    <StageLayout
      headline="These were sealed before anything ran."
      subhead="You can read them, and so can anyone else with the transaction. Nobody can change them — that ordering is the whole point."
      panel={panel}
    >
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-3">
          <LockIcon className="size-4 text-[var(--success)]" />
          <SectionLabel>Stages 1 to 3</SectionLabel>
          <Badge
            variant="outline"
            className="rounded-md border-[color-mix(in_oklab,var(--success)_45%,transparent)] px-2 py-0 text-[11px] font-normal text-[var(--success)]"
          >
            sealed
          </Badge>
          {seal.tx ? (
            <a
              href={txUrl(seal.chain, seal.tx)}
              target="_blank"
              rel="noreferrer"
              className="vtec-num inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              {seal.tx.slice(0, 14)}…
              <ExternalLinkIcon className="size-3" />
            </a>
          ) : null}
        </div>

        <div className="flex flex-col rounded-xl border border-border/60 bg-card/40 p-6 md:p-8">
          <SpecRow label="Card">
            {gpu ? `${gpu.name} · ${gpu.smCount} SM · ${gpu.l2CacheMb} MB L2` : "—"}
          </SpecRow>
          <SpecRow label="Hardware fingerprint">
            {gpu ? <HashChip value={gpu.hwFingerprint} /> : "—"}
          </SpecRow>
          <SpecRow label="Task">{task ?? "—"}</SpecRow>
          <SpecRow label="Message length">
            {plan ? bytes(plan.messageLengthBytes) : "—"}
          </SpecRow>
          <SpecRow label="Job sizes">
            <span className="vtec-num">
              {plan?.batchSizes.map(num).join(" / ")}
            </span>
          </SpecRow>
          <SpecRow label="Plan hash">
            {seal.planHash ? <HashChip value={seal.planHash} /> : "—"}
          </SpecRow>
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-card/40 p-6 md:p-8">
          <SectionLabel>The rules, as sealed</SectionLabel>
          <ol className="flex flex-col gap-3">
            {sentences.map((sentence, index) => (
              <li key={sentence.id} className="flex gap-3">
                <span className="vtec-num pt-0.5 text-sm text-muted-foreground">
                  {index + 1}.
                </span>
                <span className="text-sm leading-relaxed text-muted-foreground">
                  {sentence.text}
                </span>
              </li>
            ))}
          </ol>
        </div>

        <PrimaryAction onClick={() => goTo(Math.max(state.reached, 5))}>
          Back to where you were
        </PrimaryAction>
      </div>
    </StageLayout>
  );
}
