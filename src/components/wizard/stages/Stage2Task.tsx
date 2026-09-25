"use client";

import * as React from "react";
import { BinaryIcon, RulerIcon, ShieldCheckIcon } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SpecRow } from "@/components/vtec/primitives";
import { TASKS } from "@/data/vtec/variants";
import type { TaskId } from "@/data/vtec/types";
import { num } from "@/lib/format";
import {
  ActionCard,
  FeatureRow,
  PrimaryAction,
  RightPanel,
  StageLayout,
} from "../shell";
import type { Saga } from "../useSaga";

const ORACLE_VECTORS = 1000;
const BOUNDARIES = [55, 56, 64];

export default function Stage2Task({ saga }: { saga: Saga }) {
  const { state, set, advance } = saga;
  const task = state.task;
  const [oracleAccepted, setOracleAccepted] = React.useState(false);
  const gpu = state.agent.gpu;

  const panel = (
    <RightPanel
      label="Task"
      state={task ? "chosen" : "waiting"}
      tone={task ? "success" : "muted"}
      orb={state.agent.status === "found" ? "found" : "idle"}
      focal={
        <div className="flex flex-col gap-2">
          <span className="vtec-num text-2xl font-medium">
            {task ?? "—"}
          </span>
          <span className="text-sm text-muted-foreground">
            {task
              ? `Checked against ${TASKS[task].oracle}`
              : "No task chosen yet"}
          </span>
        </div>
      }
      helper={
        task
          ? "Correctness is decided before anything is timed. A wrong kernel is never given a number."
          : "The task decides which oracle every candidate has to match."
      }
      blocked={task ? undefined : "Choose a task first."}
      pills={[
        "bit-exact",
        `${num(ORACLE_VECTORS)} vectors`,
        `${BOUNDARIES.join(" / ")}-byte boundaries`,
        gpu ? `on ${gpu.name}` : "no card",
      ]}
    />
  );

  return (
    <StageLayout
      headline="Pick what you want measured."
      subhead="One task per project. The task decides the correctness oracle, and the oracle decides which candidates are even allowed to be timed."
      panel={panel}
    >
      <ActionCard
        n={1}
        title="Choose the task"
        why="Only tasks with an oracle we can check against are available. Without one, a candidate could be fast because it is wrong, and we would have no way to tell."
        state={task ? "complete" : "active"}
      >
        <Select
          value={task ?? undefined}
          onValueChange={(value) =>
            set((current) => ({ ...current, task: value as TaskId }))
          }
        >
          <SelectTrigger className="w-full max-w-sm">
            <SelectValue placeholder="Select a task" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sha256">sha256</SelectItem>
            <SelectItem value="keccak256" disabled>
              keccak256 — coming soon
            </SelectItem>
          </SelectContent>
        </Select>
        {task ? (
          <p className="text-sm leading-relaxed text-muted-foreground">
            {TASKS[task].description}
          </p>
        ) : null}
      </ActionCard>

      <ActionCard
        n={2}
        title="Confirm the correctness oracle"
        why="Every candidate is checked against this before it is timed. Anything that does not match is rejected outright and never appears in a measurement — a wrong kernel can be arbitrarily fast."
        state={oracleAccepted ? "complete" : task ? "active" : "future"}
      >
        <div className="flex flex-col">
          <FeatureRow icon={<ShieldCheckIcon />} title="Reference implementation">
            {task ? TASKS[task].oracle : "Chosen with the task"}, run on the same
            inputs on the CPU.
          </FeatureRow>
          <FeatureRow icon={<BinaryIcon />} title="Fixed test vectors">
            {num(ORACLE_VECTORS)} of them, the same set every run, so a
            candidate cannot pass by luck.
          </FeatureRow>
          <FeatureRow icon={<RulerIcon />} title="Padding boundaries included">
            {BOUNDARIES.join(", ")} bytes — where a wrong implementation is
            wrong, and where a quick smoke test would miss it.
          </FeatureRow>
        </div>

        <div className="flex flex-col">
          <SpecRow label="Match required">byte-for-byte</SpecRow>
          <SpecRow label="On mismatch">
            rejected, and never timed
          </SpecRow>
        </div>

        <div className="flex items-center gap-3">
          <PrimaryAction
            disabled={!task}
            onClick={() => {
              setOracleAccepted(true);
              advance();
            }}
          >
            Accept this oracle
          </PrimaryAction>
          {!task ? (
            <span className="text-xs text-muted-foreground">
              Choose a task first.
            </span>
          ) : null}
        </div>
      </ActionCard>
    </StageLayout>
  );
}
