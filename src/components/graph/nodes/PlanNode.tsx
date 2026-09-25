"use client";

import { FileLock2Icon } from "lucide-react";
import type { Node, NodeProps } from "@xyflow/react";
import { num, shortHash } from "@/lib/format";
import type { FlowNodeData } from "../types";
import { NodeShell } from "./NodeShell";

/** The rules, hashed before a single kernel was compiled. */
export function PlanNode({ data }: NodeProps<Node<FlowNodeData>>) {
  const { run, status } = data;
  const resolved = status !== "queued" && status !== "processing";

  return (
    <NodeShell
      kicker="test plan"
      title="Rules sealed"
      icon={<FileLock2Icon className="size-3.5" />}
      status={status}
      dimmed={data.dimmed}
      active={data.active}
      inspected={data.inspected}
      hasInput={false}
      metrics={[
        { label: "task", value: run.plan.task },
        { label: "oracle vectors", value: num(run.plan.oracle.vectors) },
        {
          label: "plan hash",
          value: resolved ? shortHash(run.planHash, 6, 4) : "—",
          strong: resolved,
        },
      ]}
    />
  );
}

export default PlanNode;
