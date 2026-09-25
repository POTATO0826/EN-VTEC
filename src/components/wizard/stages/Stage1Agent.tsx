"use client";

import * as React from "react";
import Link from "next/link";
import {
  CpuIcon,
  FingerprintIcon,
  RadarIcon,
  TerminalIcon,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CopyButton,
  HashChip,
  SpecRow,
} from "@/components/vtec/primitives";
import { AGENT_INSTALL_COMMAND, detectGpu } from "@/lib/agent";
import { vram } from "@/lib/format";
import {
  ActionCard,
  FeatureRow,
  PrimaryAction,
  RightPanel,
  StageLayout,
} from "../shell";
import type { Saga } from "../useSaga";

export default function Stage1Agent({ saga }: { saga: Saga }) {
  const { state, set, advance } = saga;
  const agent = state.agent;
  const gpu = agent.gpu;

  const absent = React.useMemo(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("agent") === "none";
  }, []);

  const scan = React.useCallback(async () => {
    set((current) => ({
      ...current,
      agent: { ...current.agent, status: "scanning" },
    }));
    const result = await detectGpu({ absent });
    set((current) => ({
      ...current,
      agent: result.ok
        ? { status: "found", gpu: result.gpu, detectedAt: result.detectedAt }
        : { status: "absent", gpu: null, detectedAt: null },
    }));
  }, [absent, set]);

  const scanning = agent.status === "scanning";
  const found = agent.status === "found" && !!gpu;

  const panel = (
    <RightPanel
      label="Agent"
      state={
        agent.status === "found"
          ? "ready"
          : agent.status === "scanning"
            ? "scanning"
            : agent.status === "absent"
              ? "blocked"
              : "idle"
      }
      tone={
        agent.status === "found"
          ? "success"
          : agent.status === "absent"
            ? "danger"
            : agent.status === "scanning"
              ? "info"
              : "muted"
      }
      orb={
        agent.status === "found"
          ? "found"
          : agent.status === "scanning"
            ? "scanning"
            : "idle"
      }
      orbSize={200}
      focal={
        found ? (
          <div className="flex flex-col gap-1">
            <span className="text-xl font-medium">{gpu.name}</span>
            <span className="text-sm text-muted-foreground">
              {gpu.smCount} SM · {gpu.l2CacheMb} MB L2
            </span>
          </div>
        ) : scanning ? (
          <div className="flex w-full flex-col items-center gap-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-28" />
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">
            No card read yet
          </span>
        )
      }
      helper={
        found
          ? "Read from the card itself through a standard call, not typed in."
          : scanning
            ? "Reading the device properties."
            : agent.status === "absent"
              ? "Nothing answered on this machine."
              : "The agent is waiting to read your card."
      }
      blocked={
        found
          ? undefined
          : agent.status === "absent"
            ? "Install the local agent on the machine with the GPU, then reload."
            : "Detect your GPU first."
      }
      pills={
        found
          ? [
              `${gpu.smCount} SM`,
              `${gpu.l2CacheMb} MB L2`,
              `cc ${gpu.computeCapability}`,
              vram(gpu.vramMb),
            ]
          : ["no card yet"]
      }
    />
  );

  return (
    <StageLayout
      headline="Detect the card you want to test."
      subhead="I read your card directly. No form — a typed spec could be wrong or dishonest, and the fingerprint has to be exact."
      panel={panel}
    >
      {agent.status === "absent" ? (
        <Alert variant="danger">
          <TerminalIcon />
          <AlertTitle>
            Creating a project needs the local agent on the machine with the GPU
          </AlertTitle>
          <AlertDescription>
            <p>
              The agent is what reads the card and runs the sweep. Nothing can
              be measured from a browser, so the wizard stops here rather than
              pretending otherwise.
            </p>
            <div className="flex w-full flex-wrap items-center gap-3">
              <code className="vtec-num rounded-md border border-border/60 px-3 py-2 text-xs">
                {AGENT_INSTALL_COMMAND}
              </code>
              <CopyButton value={AGENT_INSTALL_COMMAND} label="Copy command" />
            </div>
            <p>
              Browsing does not need any of this.{" "}
              <Link href="/" className="text-foreground underline">
                Browse the registry instead
              </Link>
              .
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      <ActionCard
        n={1}
        title="Let the agent read the card"
        why="Your GPU reports itself through a standard device query. A spec you type in could be wrong, out of date, or simply untrue, and the hardware fingerprint has to be exact for the result to mean anything."
        state={found ? "complete" : "active"}
      >
        <div className="flex flex-col">
          <FeatureRow icon={<RadarIcon />} title="Device query, not a form">
            Name, memory, SM count, cache and driver come straight from the
            driver.
          </FeatureRow>
          <FeatureRow
            icon={<FingerprintIcon />}
            title="Hardware fingerprint"
          >
            Derived from those properties, so a result can be tied to the exact
            card that produced it.
          </FeatureRow>
        </div>
        <PrimaryAction onClick={scan} disabled={scanning}>
          {scanning
            ? "Reading the card…"
            : found
              ? "Scan again"
              : "Detect my GPU"}
        </PrimaryAction>
      </ActionCard>

      <ActionCard
        n={2}
        title="Confirm the fingerprint"
        why="Everything after this is recorded against this card. Check it is the one you meant before the rules are written against it."
        state={found ? "active" : "future"}
      >
        {found ? (
          <div className="flex flex-col">
            <SpecRow label="GPU">{gpu.name}</SpecRow>
            <SpecRow label="VRAM">{vram(gpu.vramMb)}</SpecRow>
            <SpecRow label="Streaming multiprocessors">{gpu.smCount}</SpecRow>
            <SpecRow label="L2 cache">{gpu.l2CacheMb} MB</SpecRow>
            <SpecRow label="Compute capability">
              {gpu.computeCapability}
            </SpecRow>
            <SpecRow label="Driver">{gpu.driverVersion}</SpecRow>
            <SpecRow label="Hardware fingerprint">
              <HashChip value={gpu.hwFingerprint} />
            </SpecRow>
          </div>
        ) : (
          <div className="flex items-start gap-4 py-2">
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/60 text-muted-foreground">
              <CpuIcon className="size-[18px]" />
            </span>
            <p className="pt-2 text-sm text-muted-foreground">
              Nothing to confirm until the agent has read a card.
            </p>
          </div>
        )}
        <p className="text-sm leading-relaxed text-muted-foreground">
          No forms. Your GPU reports itself through a standard call — exact, and
          impossible to mistype.
        </p>
        <div className="flex items-center gap-3">
          <PrimaryAction onClick={advance} disabled={!found}>
            Use this card
          </PrimaryAction>
          {!found ? (
            <span className="text-xs text-muted-foreground">
              Detect your GPU first.
            </span>
          ) : null}
        </div>
      </ActionCard>

      {agent.status === "idle" ? (
        <Button
          variant="ghost"
          size="sm"
          className="w-fit text-xs text-muted-foreground"
          asChild
        >
          <Link href="/projects/new?agent=none">
            Show me what happens with no agent installed
          </Link>
        </Button>
      ) : null}
    </StageLayout>
  );
}
