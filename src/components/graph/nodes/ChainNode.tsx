"use client";

import { BlocksIcon } from "lucide-react";
import type { Node, NodeProps } from "@xyflow/react";
import { shortHash } from "@/lib/format";
import type { FlowNodeData } from "../types";
import { NodeShell } from "./NodeShell";

/**
 * A transaction. Used for both ends of the commit-reveal: the commit that locks
 * the rules before anything runs, and the reveal that publishes the result
 * against that same hash.
 */
export function ChainNode({ data }: NodeProps<Node<FlowNodeData>>) {
  const { node, run, status } = data;
  const isReveal = node.id === "reveal";
  const tx = isReveal ? run.revealTx : run.commitTx;
  const resolved = status !== "queued" && status !== "processing";

  return (
    <NodeShell
      kicker={isReveal ? "reveal tx" : "commit tx"}
      title={isReveal ? "Result published" : "Rules locked onchain"}
      icon={<BlocksIcon className="size-3.5" />}
      status={status}
      dimmed={data.dimmed}
      active={data.active}
      inspected={data.inspected}
      emphasis
      metrics={[
        { label: "chain", value: run.chain },
        { label: "signed by", value: run.committedBy },
        {
          label: "tx",
          value: resolved ? shortHash(tx, 6, 4) : "pending",
          strong: resolved,
        },
      ]}
    />
  );
}

export default ChainNode;
