"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "cn";
import { CheckIcon, XIcon } from "lucide-react";
import { useSessionId, useSessionStatus, type SessionStatus } from "@/lib/session";
import { SUI } from "@/lib/sui-tx";

type StageState = "done" | "current" | "todo" | "failed";
type Stage = { label: string; detail: string; href: string; state: StageState };

/**
 * The whole journey in one line, on every page: where you are, what's done,
 * and what to do next. Every stage links to the page where it happens.
 */
function stagesFor(status: SessionStatus | null): { stages: Stage[]; next: string } {
  const setup = !!status?.seat && !!status?.agent;
  const approval = status?.approval ?? null;
  const sub = status?.submission ?? null;
  const trackHref = `/tuners/${approval?.trackId ?? sub?.trackId ?? ""}`.replace(/\/$/, "");

  // Which stage this cycle is at (1-6). A new approval starts a new cycle.
  let current: number;
  if (!setup) current = 1;
  else if (approval) current = approval.paid ? 4 : 3;
  else if (sub && (sub.status === "pending" || sub.status === "verifying")) current = 5;
  else if (sub?.status === "verified") current = 7;
  else current = 2;

  const rejected = current === 2 && sub?.status === "rejected";
  const s = (n: number): StageState => (n < current ? "done" : n === current ? "current" : "todo");

  const stages: Stage[] = [
    { label: "Set up", detail: setup ? "World ID + agent" : "World ID, agent", href: "/", state: s(1) },
    { label: "Approve", detail: "World ID", href: trackHref || "/tuners", state: s(2) },
    { label: "Pay", detail: `${SUI.feeSui} SUI · Slush`, href: trackHref || "/tuners", state: s(3) },
    { label: "Submit", detail: "agent runs it", href: trackHref || "/tuners", state: s(4) },
    {
      label: "Verification",
      detail: rejected ? "rejected" : current === 5 ? sub?.status ?? "" : "re-run by others",
      href: sub ? `/tuners/${sub.trackId}#${sub.id}` : "/verify",
      state: rejected ? "failed" : s(5),
    },
    { label: "Ranking", detail: current === 7 ? "you're on it" : "verified only", href: "/ranking", state: s(6) },
  ];

  const next =
    current === 1
      ? "Finish Get started: verify with World ID and connect your agent."
      : current === 2
        ? rejected
          ? `Your last submission to ${sub!.track} was rejected. Open it to see why, then try a faster build.`
          : "Pick a track and approve a submission with World ID."
        : current === 3
          ? `Pay the ${SUI.feeSui} SUI process fee with Slush.`
          : current === 4
            ? "Run the submit command with your agent."
            : current === 5
              ? "Your build is being re-run by verifiers. This takes a few minutes."
              : "Verified! Your build is on the Kernel Code Efficiency Ranking.";
  return { stages, next };
}

export default function JourneyBar() {
  const sessionId = useSessionId();
  const { status } = useSessionStatus(sessionId, 4000);
  const { stages, next } = stagesFor(status);

  return (
    <div className="relative z-10 border-b border-border/60 bg-black/20 backdrop-blur-sm">
      <div className="mx-auto w-full max-w-6xl px-4 py-3 md:px-8">
        <ol className="flex items-stretch gap-1 overflow-x-auto">
          {stages.map((stage, i) => (
            <li key={stage.label} className="flex min-w-[112px] flex-1 items-center gap-1">
              <Link
                href={stage.href}
                className={cn(
                  "group flex flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 text-foreground transition-colors hover:bg-accent/50 hover:text-foreground",
                  stage.state === "current" && "bg-accent/60",
                )}
              >
                <span
                  className={cn(
                    "inline-flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] transition-colors",
                    stage.state === "done" && "border-transparent bg-[var(--success)] text-black",
                    stage.state === "current" && "border-primary text-primary ring-2 ring-primary/30",
                    stage.state === "todo" && "border-border text-muted-foreground",
                    stage.state === "failed" && "border-transparent bg-[var(--danger)] text-black",
                  )}
                >
                  {stage.state === "done" ? (
                    <CheckIcon className="size-3.5" />
                  ) : stage.state === "failed" ? (
                    <XIcon className="size-3.5" />
                  ) : (
                    i + 1
                  )}
                </span>
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className={cn("text-xs font-medium", stage.state === "todo" && "text-muted-foreground")}>
                    {stage.label}
                  </span>
                  <span className="truncate text-[11px] text-muted-foreground">{stage.detail}</span>
                </span>
              </Link>
              {i < stages.length - 1 ? (
                <span
                  className={cn(
                    "hidden h-px w-3 shrink-0 sm:block",
                    stage.state === "done" ? "bg-[var(--success)]" : "bg-border",
                  )}
                />
              ) : null}
            </li>
          ))}
        </ol>
        <p className="mt-2 px-2 text-xs text-muted-foreground">
          <span className="text-foreground">Next:</span> {next}
        </p>
      </div>
    </div>
  );
}
