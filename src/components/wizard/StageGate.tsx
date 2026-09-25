"use client";

import * as React from "react";
import { cn } from "cn";
import {
  ArrowRightIcon,
  CheckIcon,
  CircleDashedIcon,
  LoaderIcon,
  XIcon,
} from "lucide-react";
import { SectionLabel } from "@/components/vtec/primitives";
import { checkStage, STAGE_ASK, type RequirementResult } from "./verify";
import type { SagaState } from "./useSaga";

/* -------------------------------------------------------------------------- */
/* What this page needs                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Shown at the top of a stage, before the user has done anything.
 *
 * The complaint this answers: three stages in a row looked identical and none
 * of them said what was wanted. Now the first thing on every stage is the ask,
 * in the imperative, and the list of what has to be true before you can move on
 * - with the ones already satisfied ticked off as you go.
 */
export function StageNeeds({
  state,
  stage,
}: {
  state: SagaState;
  stage: number;
}) {
  const results = checkStage(state, stage);
  const ask = STAGE_ASK[stage];
  if (!ask || results.length === 0) return null;

  const outstanding = results.filter((result) => !result.met).length;

  return (
    <div className={cn("vtec-needs", `vtec-needs-${ask.kind}`)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm font-medium text-foreground">
          <span className="vtec-needs-verb">{ask.verb}</span> {ask.ask}
        </p>
        <span className="vtec-kicker shrink-0">
          {outstanding === 0
            ? "all requirements met"
            : `${outstanding} of ${results.length} still needed`}
        </span>
      </div>

      <ul className="flex flex-col gap-1.5">
        {results.map((result) => (
          <li key={result.requirement.label} className="flex items-start gap-2.5">
            <span
              className={cn(
                "vtec-needs-mark",
                result.met && "vtec-needs-mark-met",
              )}
              aria-hidden
            >
              {result.met ? (
                <CheckIcon className="size-3" strokeWidth={3} />
              ) : (
                <CircleDashedIcon className="size-3" />
              )}
            </span>
            <span className="flex flex-1 flex-wrap items-baseline justify-between gap-x-3">
              <span
                className={cn(
                  "text-[13px] leading-snug",
                  result.met ? "text-muted-foreground" : "text-foreground",
                )}
              >
                {result.requirement.label}
              </span>
              {result.evidence ? (
                <span className="vtec-num text-[11px] text-muted-foreground">
                  {result.evidence}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The gate                                                                    */
/* -------------------------------------------------------------------------- */

type Phase = "idle" | "checking" | "passed" | "failed";

/**
 * The only way forward.
 *
 * Pressing Continue runs the stage's requirements one at a time with a short
 * visible pause between each, so the check is something you watch happen rather
 * than a button that silently enables. If every requirement passes it advances
 * on its own. If one fails it stops there and says what is missing.
 *
 * The animation is deliberately quick - about half a second for a typical stage
 * - because its job is to be legible, not to feel like work is being done. It
 * is skipped entirely under prefers-reduced-motion.
 */
export function StageGate({
  state,
  stage,
  onAdvance,
  label = "Continue",
  className,
}: {
  state: SagaState;
  stage: number;
  onAdvance: () => void;
  label?: string;
  className?: string;
}) {
  const [phase, setPhase] = React.useState<Phase>("idle");
  /** How many requirements have been revealed so far while checking. */
  const [revealed, setRevealed] = React.useState(0);
  const timers = React.useRef<ReturnType<typeof setTimeout>[]>([]);

  const results = checkStage(state, stage);
  const firstFailure = results.find((result) => !result.met) ?? null;

  const clearTimers = React.useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  React.useEffect(() => clearTimers, [clearTimers]);

  // Editing the stage after a failed check clears the verdict, so the panel is
  // never showing a stale "missing" for something that has since been supplied.
  React.useEffect(() => {
    setPhase("idle");
    setRevealed(0);
    clearTimers();
  }, [state, stage, clearTimers]);

  const run = React.useCallback(() => {
    clearTimers();

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const finish = () => {
      if (results.every((result) => result.met)) {
        setPhase("passed");
        timers.current.push(setTimeout(onAdvance, reduced ? 0 : 260));
      } else {
        setPhase("failed");
      }
    };

    if (reduced || results.length === 0) {
      setRevealed(results.length);
      finish();
      return;
    }

    setPhase("checking");
    setRevealed(0);

    const perCheck = 130;
    results.forEach((_result, index) => {
      timers.current.push(
        setTimeout(() => setRevealed(index + 1), perCheck * (index + 1)),
      );
    });
    timers.current.push(setTimeout(finish, perCheck * results.length + 120));
  }, [clearTimers, onAdvance, results]);

  const checking = phase === "checking";

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {checking || phase === "failed" ? (
        <div className="vtec-gate" data-phase={phase}>
          <SectionLabel>
            {checking ? "Checking this stage" : "Not ready yet"}
          </SectionLabel>
          <ul className="flex flex-col gap-1.5">
            {results.map((result, index) => (
              <GateRow
                key={result.requirement.label}
                result={result}
                revealed={index < revealed}
                checking={checking}
              />
            ))}
          </ul>
          {phase === "failed" && firstFailure ? (
            <p className="text-[13px] leading-relaxed text-[var(--warning)]">
              {firstFailure.requirement.missing}
            </p>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        onClick={run}
        disabled={checking}
        className={cn(
          "vtec-gate-button",
          phase === "passed" && "is-passed",
          phase === "failed" && "is-failed",
        )}
      >
        {checking ? (
          <LoaderIcon className="size-4 animate-spin" />
        ) : phase === "passed" ? (
          <CheckIcon className="size-4" strokeWidth={3} />
        ) : (
          <ArrowRightIcon className="size-4" />
        )}
        {checking
          ? "Checking…"
          : phase === "passed"
            ? "Verified"
            : phase === "failed"
              ? "Check again"
              : label}
      </button>
    </div>
  );
}

function GateRow({
  result,
  revealed,
  checking,
}: {
  result: RequirementResult;
  revealed: boolean;
  checking: boolean;
}) {
  const pending = checking && !revealed;

  return (
    <li className="flex items-start gap-2.5">
      <span
        className={cn(
          "vtec-gate-mark",
          pending && "is-pending",
          !pending && result.met && "is-met",
          !pending && !result.met && "is-unmet",
        )}
        aria-hidden
      >
        {pending ? (
          <CircleDashedIcon className="size-3" />
        ) : result.met ? (
          <CheckIcon className="size-3" strokeWidth={3} />
        ) : (
          <XIcon className="size-3" strokeWidth={3} />
        )}
      </span>
      <span className="flex flex-1 flex-wrap items-baseline justify-between gap-x-3">
        <span
          className={cn(
            "text-[13px] leading-snug transition-colors",
            pending
              ? "text-muted-foreground/50"
              : result.met
                ? "text-muted-foreground"
                : "text-foreground",
          )}
        >
          {result.requirement.label}
        </span>
        {!pending && result.evidence ? (
          <span className="vtec-num text-[11px] text-muted-foreground">
            {result.evidence}
          </span>
        ) : null}
      </span>
    </li>
  );
}
