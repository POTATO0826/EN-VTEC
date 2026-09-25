"use client";

import { MinusCircleIcon } from "lucide-react";
import type { Node, NodeProps } from "@xyflow/react";
import type { FlowNodeData } from "../types";
import { NodeShell } from "./NodeShell";

/**
 * A job size that was never attempted. It hangs off the commit and is never
 * travelled, because nothing ran — but it is part of the record, not a gap in
 * it, so it gets a module of its own rather than being left out.
 */
export function SkipNode({ data }: NodeProps<Node<FlowNodeData>>) {
  const { node, status } = data;

  return (
    <NodeShell
      kicker="not attempted"
      title={node.label}
      icon={<MinusCircleIcon className="size-3.5" />}
      status={status}
      dimmed={data.dimmed}
      active={data.active}
      inspected={data.inspected}
      hasOutput={false}
      metrics={[{ label: "reason", value: "see inspector" }]}
    />
  );
}

export default SkipNode;
