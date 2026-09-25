"use client";

import { GaugeIcon, ShieldCheckIcon } from "lucide-react";
import type { Node, NodeProps } from "@xyflow/react";
import { ms, num, pct } from "@/lib/format";
import { medianFor } from "../metrics";
import type { FlowNodeData, Metric } from "../types";
import { NodeShell } from "./NodeShell";

/**
 * A gate a candidate has to clear. Two kinds, one component, because they are
 * the same shape: a rule, a measurement, and a verdict that is allowed to be no.
 *
 *   correctness — byte-exact against the oracle, or it is never timed at all
 *   noise gate  — beat the baseline by more than this machine's own noise
 */
export function GateNode({ data }: NodeProps<Node<FlowNodeData>>) {
  const { node, run, status } = data;
  const isCorrectness = node.id.startsWith("corr-");
  const settled = status !== "queued" && status !== "processing";

  const metrics: Metric[] = [];
  if (isCorrectness) {
    metrics.push({ label: "oracle", value: run.plan.oracle.name });
    metrics.push({
      label: "vectors",
      value: settled ? num(run.plan.oracle.vectors) : "—",
      strong: settled,
    });
  } else if (node.timings) {
    metrics.push({
      label: "median",
      value: settled ? ms(node.timings.medianMs) : "—",
      strong: settled,
    });
    metrics.push({
      label: "spread",
      value: settled ? ms(node.timings.stdevMs) : "—",
    });
    metrics.push({ label: "noise band", value: pct(run.noiseBand) });
  } else {
    // The baseline's gate carries no per-candidate timings, because the
    // baseline is what candidates are timed against. Its median is in the curve.
    const median = medianFor(run, node.variant);
    metrics.push({
      label: median === null ? "role" : "median",
      value: median === null ? "baseline" : settled ? ms(median) : "—",
      strong: settled && median !== null,
    });
    metrics.push({ label: "noise band", value: pct(run.noiseBand) });
    metrics.push({
      label: "runs",
      value: `${run.plan.runsPerMeasurement}, first dropped`,
    });
  }

  return (
    <NodeShell
      kicker={isCorrectness ? "correctness" : "noise gate"}
      title={isCorrectness ? "Byte-exact or nothing" : "Beat the band"}
      icon={
        isCorrectness ? (
          <ShieldCheckIcon className="size-3.5" />
        ) : (
          <GaugeIcon className="size-3.5" />
        )
      }
      status={status}
      dimmed={data.dimmed}
      active={data.active}
      inspected={data.inspected}
      chosen={data.chosen}
      metrics={metrics}
      // A failed correctness gate is the end of its branch: no output port.
      hasOutput={!(isCorrectness && node.status === "failed")}
    />
  );
}

export default GateNode;
