import type { NodeStatus, PipelineNode, Run } from "@/data/vtec/types";

/**
 * What every node on the canvas is handed.
 *
 * Deliberately small and recomputed only when the leg index changes, never per
 * animation frame — the agent moves through a `ViewportPortal` that writes its
 * own transform, so nothing here is on the 60fps path.
 */
export type FlowNodeData = {
  node: PipelineNode;
  run: Run;
  /** Status at the current point in the journey, not the recorded final one. */
  status: NodeStatus;
  /** Off the hovered node's path, so it should recede. */
  dimmed: boolean;
  /** The agent is standing on this node right now. */
  active: boolean;
  /** Pinned open in the inspector. */
  inspected: boolean;
  /** On the branch the run commits to. */
  chosen: boolean;
};

/** One row on a node face. Values are pre-formatted; nodes never do maths. */
export type Metric = { label: string; value: string; strong?: boolean };

export type EdgeTone = "idle" | "active" | "done" | "dead";

export type FlowEdgeData = {
  tone: EdgeTone;
  dimmed: boolean;
  /** The agent is on this wire, so it carries the travelling pulse. */
  travelling: boolean;
};
