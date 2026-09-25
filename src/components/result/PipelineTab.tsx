"use client";

import * as React from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { CpuIcon } from "lucide-react";
import NodeInspector from "@/components/controls/NodeInspector";
import PipelineControls from "@/components/controls/PipelineControls";
import VtecCanvas from "@/components/graph/VtecCanvas";
import { SectionLabel, StatusBadge, StatusDot } from "@/components/vtec/primitives";
import { buildPipeline, gpuFor } from "@/data/vtec";
import { buildJourney } from "@/data/vtec/journey";
import type { Leg } from "@/data/vtec/journey";
import { VARIANTS } from "@/data/vtec/variants";
import type { NodeStatus, PipelineNode, Run } from "@/data/vtec/types";
import { usePipelineRun } from "@/hooks/usePipelineRun";
import { num, vram } from "@/lib/format";

const LEGEND: { status: NodeStatus; meaning: string }[] = [
  { status: "queued", meaning: "not started" },
  { status: "processing", meaning: "running" },
  { status: "passed", meaning: "cleared the gate" },
  { status: "accepted", meaning: "won" },
  { status: "rejected", meaning: "inside the noise" },
  { status: "failed", meaning: "wrong output" },
  { status: "skipped", meaning: "not run" },
  { status: "published", meaning: "onchain" },
];

/** What the agent is doing, in one line, for the HUD status row. */
function stageLabelFor(leg: Leg | null, done: boolean): string {
  if (done) return "Run complete — the record is published.";
  if (!leg) return "Idle. Nothing has run yet.";
  const variant = leg.variant
    ? `variant ${leg.variant} — ${VARIANTS[leg.variant].label}`
    : "";
  switch (leg.phase) {
    case "open":
      return "Sealing the plan and committing it onchain.";
    case "probe":
      return `Measuring ${variant}.`;
    case "return":
      return "Backing out to the fan-out.";
    case "select":
      return `Committing to ${variant}.`;
    case "publish":
      return "Writing the result to the registry and onchain.";
  }
}

export default function PipelineTab({
  run,
  live = false,
}: {
  run: Run;
  live?: boolean;
}) {
  const pipeline = React.useMemo(() => buildPipeline(run), [run]);
  const journey = React.useMemo(
    () => buildJourney(run, pipeline),
    [run, pipeline],
  );
  const pipelineRun = usePipelineRun(journey, { autoPlay: live });

  const [inspectedId, setInspectedId] = React.useState<string | null>(null);
  const [activeNodeId, setActiveNodeId] = React.useState<string | null>(null);
  const [layoutSignal, setLayoutSignal] = React.useState(0);

  const shellRef = React.useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = React.useState(false);

  React.useEffect(() => {
    const onChange = () =>
      setFullscreen(document.fullscreenElement === shellRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  /* The canvas should reach the bottom of the window whatever the header above
     it happens to be. CSS cannot know that offset, so it is measured once and
     published as a custom property; the height itself never feeds back into it,
     because what sits above the shell does not depend on how tall the shell is. */
  React.useEffect(() => {
    const element = shellRef.current;
    if (!element) return;
    const measure = () => {
      const top = element.getBoundingClientRect().top + window.scrollY;
      element.style.setProperty("--vtec-canvas-top", `${Math.round(top)}px`);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const toggleFullscreen = React.useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void shellRef.current?.requestFullscreen?.();
    }
  }, []);

  const reset = React.useCallback(() => {
    pipelineRun.reset();
    setInspectedId(null);
    setLayoutSignal((value) => value + 1);
  }, [pipelineRun]);

  const nodeById = React.useMemo(() => {
    const map = new Map<string, PipelineNode>();
    for (const node of pipeline.nodes) map.set(node.id, node);
    return map;
  }, [pipeline.nodes]);

  // Pinned wins; otherwise the panel rides along with the agent.
  const shownNode =
    (inspectedId && nodeById.get(inspectedId)) ||
    (activeNodeId ? (nodeById.get(activeNodeId) ?? null) : null);

  const inFlight =
    pipelineRun.legIndex > 0 ? journey.legs[pipelineRun.legIndex - 1] : null;
  const gpu = gpuFor(run);

  return (
    <div className="flex flex-col gap-4">
      <div ref={shellRef} className="vtec-canvas-shell">
        <ReactFlowProvider>
          <VtecCanvas
            run={run}
            pipeline={pipeline}
            journey={journey}
            pipelineRun={pipelineRun}
            inspectedId={inspectedId}
            onInspect={setInspectedId}
            onActiveNode={setActiveNodeId}
            layoutSignal={layoutSignal}
          />
        </ReactFlowProvider>

        {/* Identity, top left. */}
        <div className="vtec-hud vtec-hud-title">
          <SectionLabel>Pipeline</SectionLabel>
          <p className="text-sm leading-snug font-medium text-foreground">
            {gpu.name}
          </p>
          <p className="vtec-kicker">
            {run.task} · {num(run.headlineJobSize)} messages
          </p>
        </div>

        {/* Machine and chain, top right. */}
        <div className="vtec-hud vtec-hud-status">
          <Fact label="gpu" value={`${gpu.name} · ${vram(gpu.vramMb)}`} />
          <Fact label="network" value={run.chain} />
          <Fact label="compute" value={gpu.computeCapability} />
          <div className="flex items-center justify-between gap-4">
            <span className="vtec-kicker">status</span>
            <span className="flex items-center gap-1.5 text-[11px] text-foreground">
              <StatusDot
                tone={
                  pipelineRun.phase === "running"
                    ? "info"
                    : run.status === "verified"
                      ? "success"
                      : "warning"
                }
              />
              {pipelineRun.phase === "running"
                ? "running"
                : run.status === "no-winner"
                  ? "no winner"
                  : "ready"}
            </span>
          </div>
        </div>

        <PipelineControls
          run={pipelineRun}
          journey={journey}
          onReset={reset}
          fullscreen={fullscreen}
          onToggleFullscreen={toggleFullscreen}
          stageLabel={stageLabelFor(
            pipelineRun.phase === "idle" ? null : inFlight,
            pipelineRun.phase === "done",
          )}
        />

        <NodeInspector
          run={run}
          journey={journey}
          node={shownNode}
          legIndex={pipelineRun.legIndex}
          pinned={Boolean(inspectedId)}
          onUnpin={() => setInspectedId(null)}
        />
      </div>

      <div className="flex flex-col gap-2 px-1">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {LEGEND.map((item) => (
            <span key={item.status} className="flex items-center gap-1.5">
              <StatusBadge status={item.status} />
              <span className="text-[10px] text-muted-foreground">
                {item.meaning}
              </span>
            </span>
          ))}
        </div>
        <span className="vtec-kicker inline-flex items-center gap-1.5">
          <CpuIcon className="size-3" />
          drag to pan · scroll to zoom · drag a module to move it · hover to
          isolate its path
        </span>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="vtec-kicker">{label}</span>
      <span className="vtec-num text-[11px] text-muted-foreground">{value}</span>
    </div>
  );
}
