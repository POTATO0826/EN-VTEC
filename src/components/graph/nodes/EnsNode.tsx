"use client";

import { GlobeIcon } from "lucide-react";
import type { Node, NodeProps } from "@xyflow/react";
import type { FlowNodeData } from "../types";
import { NodeShell } from "./NodeShell";

/** The result, resolvable without any of our software. */
export function EnsNode({ data }: NodeProps<Node<FlowNodeData>>) {
  const { node, status } = data;
  const settled = status !== "queued" && status !== "processing";

  return (
    <NodeShell
      kicker="ens"
      title="Readable outside this app"
      icon={<GlobeIcon className="size-3.5" />}
      status={status}
      dimmed={data.dimmed}
      active={data.active}
      inspected={data.inspected}
      hasOutput={false}
      metrics={[
        { label: "name", value: settled ? node.label : "—", strong: settled },
        { label: "resolver", value: "public" },
      ]}
    />
  );
}

export default EnsNode;
