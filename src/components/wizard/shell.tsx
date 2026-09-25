"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "cn";
import { LockIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Shdr13, type OrbState } from "@/components/ui/shdr-13";
import {
  NumberMarker,
  Panel,
  PanelHeader,
  Pill,
  SectionLabel,
} from "@/components/vtec/primitives";
import {
  ACTIONABLE_STAGES,
  STAGES,
  STAGE_COMMITMENTS,
  stageComplete,
  type SagaState,
} from "./useSaga";

/* -------------------------------------------------------------------------- */
/* Header                                                                      */
/* -------------------------------------------------------------------------- */

export function SagaHeader({ stage }: { stage: number }) {
  return (
    <div className="mb-10 flex items-center justify-between gap-6">
      <SectionLabel>Create your project</SectionLabel>
      <div className="flex items-center gap-4">
        <span className="text-xs tracking-[0.2em] text-muted-foreground uppercase">
          {stage > ACTIONABLE_STAGES
            ? "Live"
            : `Step ${stage} of ${ACTIONABLE_STAGES}`}
        </span>
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="h-8 rounded-full text-muted-foreground"
        >
          <Link href="/">
            <XIcon className="size-3.5" />
            Exit
          </Link>
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Left rail                                                                   */
/* -------------------------------------------------------------------------- */

export function Rail({
  state,
  goTo,
}: {
  state: SagaState;
  goTo: (stage: number) => void;
}) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <SectionLabel className="mb-4">Create your project</SectionLabel>
        {STAGES.map((item) => {
          const complete = stageComplete(state, item.id);
          const current = state.stage === item.id;
          const reachable = item.id <= state.reached;
          return (
            <button
              key={item.id}
              type="button"
              disabled={!reachable}
              onClick={() => goTo(item.id)}
              className={cn(
                "flex items-start gap-3 rounded-lg px-2 py-2.5 text-left transition-colors",
                reachable ? "hover:bg-accent/40" : "cursor-not-allowed",
              )}
            >
              <NumberMarker
                n={item.id}
                state={
                  complete && !current
                    ? "complete"
                    : current
                      ? "active"
                      : "future"
                }
              />
              <span className="flex flex-col gap-0.5 pt-1">
                <span
                  className={cn(
                    "text-sm",
                    current
                      ? "text-foreground"
                      : reachable
                        ? "text-foreground/80"
                        : "text-muted-foreground",
                  )}
                >
                  {item.rail}
                </span>
                <span
                  className={cn(
                    "text-[10px] tracking-[0.18em] uppercase",
                    current
                      ? "text-primary"
                      : complete
                        ? "text-muted-foreground"
                        : "text-muted-foreground/60",
                  )}
                >
                  {current
                    ? "in progress"
                    : complete
                      ? "complete"
                      : item.id === 9
                        ? "destination"
                        : "not started"}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <Panel className="gap-3 bg-muted/20 p-5">
        <SectionLabel>What this step commits you to</SectionLabel>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {STAGE_COMMITMENTS[state.stage]}
        </p>
      </Panel>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Stage layout                                                                */
/* -------------------------------------------------------------------------- */

export function StageLayout({
  headline,
  subhead,
  children,
  panel,
}: {
  headline: string;
  subhead: React.ReactNode;
  children: React.ReactNode;
  panel: React.ReactNode;
}) {
  return (
    <>
      <div className="flex min-w-0 flex-col gap-6">
        <div>
          <h1 className="text-4xl font-medium tracking-tight text-balance md:text-5xl">
            {headline}
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            {subhead}
          </p>
        </div>
        {children}
      </div>
      <div className="vtec-panel-col">{panel}</div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Sub-action card                                                             */
/* -------------------------------------------------------------------------- */

export function ActionCard({
  n,
  title,
  why,
  state = "active",
  children,
  className,
}: {
  n: number;
  title: string;
  why?: React.ReactNode;
  state?: "future" | "active" | "complete";
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <Panel className={cn("gap-0", className)}>
      <div className="flex gap-4 md:gap-5">
        <div className="flex flex-col items-center gap-2">
          <NumberMarker n={n} state={state} />
          {state === "active" ? (
            <span className="text-center text-[10px] leading-tight tracking-[0.18em] text-primary uppercase">
              in
              <br />
              progress
            </span>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div>
            <h2 className="text-base font-medium">{title}</h2>
            {why ? (
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {why}
              </p>
            ) : null}
          </div>
          {children}
        </div>
      </div>
    </Panel>
  );
}

/** A row inside a card: icon container, text, no border of its own. */
export function FeatureRow({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-4 py-2">
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/60 text-muted-foreground [&>svg]:size-[18px]">
        {icon}
      </span>
      <div className="flex min-w-0 flex-col gap-1 pt-1">
        <span className="text-sm">{title}</span>
        {children ? (
          <span className="text-sm leading-relaxed text-muted-foreground">
            {children}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Primary action. Disabled actions stay visible and say why in the panel. */
export function PrimaryAction({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      className={cn(
        "h-11 w-fit rounded-full px-6 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Right panel                                                                 */
/* -------------------------------------------------------------------------- */

export function RightPanel({
  label,
  state,
  tone = "muted",
  orb,
  orbSize = 96,
  focal,
  helper,
  pills = [],
  blocked,
}: {
  label: string;
  state: string;
  tone?: "success" | "warning" | "danger" | "info" | "muted";
  orb?: OrbState | null;
  orbSize?: number;
  focal?: React.ReactNode;
  helper?: React.ReactNode;
  pills?: React.ReactNode[];
  /** Why the next action is unavailable. Blockers are shown, never hidden. */
  blocked?: string;
}) {
  return (
    <Panel className="sticky top-6 min-h-[560px] gap-6 p-6 md:p-6">
      <PanelHeader label={label} state={state} tone={tone} />

      {orb ? (
        <div className="flex justify-center pt-2">
          <Shdr13 state={orb} size={orbSize} />
        </div>
      ) : null}

      <div className="flex flex-1 flex-col items-center justify-center gap-4 py-4 text-center">
        {focal}
      </div>

      {helper ? (
        <p className="text-center text-sm leading-relaxed text-muted-foreground">
          {helper}
        </p>
      ) : null}

      {blocked ? (
        <div className="flex items-start gap-2 rounded-lg border border-border/60 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          <LockIcon className="mt-0.5 size-3 shrink-0" />
          {blocked}
        </div>
      ) : null}

      {pills.length > 0 ? (
        <>
          <Separator className="bg-border/40" />
          <div className="flex flex-wrap justify-center gap-2">
            {pills.map((pill, index) => (
              <Pill key={index}>{pill}</Pill>
            ))}
          </div>
        </>
      ) : null}
    </Panel>
  );
}
