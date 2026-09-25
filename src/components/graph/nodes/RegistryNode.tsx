"use client";

import { DatabaseIcon } from "lucide-react";
import type { Node, NodeProps } from "@xyflow/react";
import { variantShort } from "@/data/vtec/variants";
import { num, pct, speedup as fmtSpeedup } from "@/lib/format";
import type { FlowNodeData, Metric } from "../types";
import { NodeShell } from "./NodeShell";

/**
 * What the dispatcher will actually read. The one place a speedup is quoted, so
 * it is quoted with the band it had to clear, per the project's copy rule.
 */
export function RegistryNode({ data }: NodeProps<Node<FlowNodeData>>) {
  const { node, run, status } = data;
  const settled = status !== "queued" && status !== "processing";
  const accepted = run.candidates.find((item) => item.verdict === "accepted");

  const metrics: Metric[] = [
    { label: "job size", value: `${num(run.headlineJobSize)} msg` },
    {
      label: "winner",
      value: settled
        ? accepted
          ? variantShort(accepted.variant)
          : `${run.plan.baselineVariant} — baseline`
        : "—",
      strong: settled,
    },
  ];
  if (settled && accepted?.speedup !== undefined) {
    metrics.push({
      label: "speedup",
      value: `${fmtSpeedup(accepted.speedup)} vs ${pct(run.noiseBand)} band`,
    });
  } else if (settled) {
    metrics.push({ label: "nothing cleared", value: pct(run.noiseBand) });
  }

  return (
    <NodeShell
      kicker="registry"
      title={node.label === "baseline retained" ? "Baseline retained" : "Winner recorded"}
      icon={<DatabaseIcon className="size-3.5" />}
      status={status}
      dimmed={data.dimmed}
      active={data.active}
      inspected={data.inspected}
      emphasis
      metrics={metrics}
    />
  );
}

export default RegistryNode;
