/**
 * Graph geometry: where the nodes sit, and where a point on a wire is.
 *
 * The agent has to ride exactly on the edge it is travelling, which means the
 * agent and the edge have to agree on the curve down to the pixel. They do,
 * because both go through `edgePath` here and nothing else draws a wire.
 */

import { Position, getSmoothStepPath, type InternalNode } from "@xyflow/react";
import dagre from "dagre";
import type { PipelineEdge, PipelineNode } from "@/data/vtec/types";

/** Operator modules: wide enough for a metric row, short enough to scan. */
export const NODE_W = 260;
export const NODE_H = 120;

/** Bigger than the old 236x104 at 72px rank separation, which fitView then
 *  shrank to roughly 0.7. The graph is meant to overflow the viewport. */
const RANK_SEP = 150;
const NODE_SEP = 48;

export type XY = { x: number; y: number };

/**
 * Dagre, left to right. The stages are ordered, so a force-directed layout
 * would destroy the one thing the graph is for.
 */
export function layoutPipeline(
  nodes: PipelineNode[],
  edges: Pick<PipelineEdge, "source" | "target">[],
): Map<string, XY> {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: "LR",
    nodesep: NODE_SEP,
    ranksep: RANK_SEP,
    marginx: 40,
    marginy: 40,
  });

  for (const node of nodes) {
    graph.setNode(node.id, { width: NODE_W, height: NODE_H });
  }
  for (const edge of edges) {
    graph.setEdge(edge.source, edge.target);
  }
  dagre.layout(graph);

  const positions = new Map<string, XY>();
  for (const node of nodes) {
    const placed = graph.node(node.id);
    positions.set(node.id, {
      x: placed.x - NODE_W / 2,
      y: placed.y - NODE_H / 2,
    });
  }
  return positions;
}

/* -------------------------------------------------------------------------- */
/* Wires                                                                       */
/* -------------------------------------------------------------------------- */

/** Right edge, vertical centre. Matches the source `<Handle>` in NodeShell. */
export function sourceAnchor(position: XY): XY {
  return { x: position.x + NODE_W, y: position.y + NODE_H / 2 };
}

/** Left edge, vertical centre. Matches the target `<Handle>` in NodeShell. */
export function targetAnchor(position: XY): XY {
  return { x: position.x, y: position.y + NODE_H / 2 };
}

/**
 * Where a node's port actually is, read from the measured handle rather than
 * assumed from `NODE_H`.
 *
 * This matters because node faces have different numbers of metric rows, so a
 * module's real height is not always the nominal one. Reading the handle is how
 * React Flow places the wire, so it is how the agent has to find it too —
 * otherwise the agent floats a few pixels off its own cable.
 */
export function handleAnchor(
  node: InternalNode | undefined,
  kind: "source" | "target",
): XY | null {
  if (!node) return null;
  const origin = node.internals.positionAbsolute;
  const bounds = node.internals.handleBounds?.[kind];
  const handle = bounds && bounds.length > 0 ? bounds[0] : null;

  if (handle) {
    const x = origin.x + handle.x;
    const y = origin.y + handle.y;
    return kind === "source"
      ? { x: x + handle.width, y: y + handle.height / 2 }
      : { x, y: y + handle.height / 2 };
  }

  // Before the first measure pass, fall back to the nominal box.
  const width = node.measured.width ?? NODE_W;
  const height = node.measured.height ?? NODE_H;
  return kind === "source"
    ? { x: origin.x + width, y: origin.y + height / 2 }
    : { x: origin.x, y: origin.y + height / 2 };
}

/**
 * The SVG path for one wire, in flow coordinates. `borderRadius` is generous so
 * the corners read as routed cable rather than as a flowchart elbow.
 */
export function edgePath(source: XY, target: XY): string {
  const [path] = getSmoothStepPath({
    sourceX: source.x,
    sourceY: source.y,
    sourcePosition: Position.Right,
    targetX: target.x,
    targetY: target.y,
    targetPosition: Position.Left,
    borderRadius: 16,
  });
  return path;
}

/** The same path, from two node positions rather than two anchors. */
export function edgePathBetween(sourceNode: XY, targetNode: XY): string {
  return edgePath(sourceAnchor(sourceNode), targetAnchor(targetNode));
}

/* -------------------------------------------------------------------------- */
/* Sampling                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A point at fraction `t` along a path string, plus the heading there.
 *
 * Measured with the browser's own path maths rather than re-deriving the
 * smoothstep segments, so it cannot drift from what is drawn. The scratch
 * element is reused: creating one per frame is the whole cost of this.
 */
let scratch: SVGPathElement | null = null;

function scratchPath(d: string): SVGPathElement | null {
  if (typeof document === "undefined") return null;
  if (!scratch) {
    scratch = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path",
    ) as SVGPathElement;
  }
  scratch.setAttribute("d", d);
  return scratch;
}

export type PathPoint = XY & { angle: number };

export function pointOnPath(d: string, t: number): PathPoint | null {
  const path = scratchPath(d);
  if (!path) return null;
  let length = 0;
  try {
    length = path.getTotalLength();
  } catch {
    return null;
  }
  if (!Number.isFinite(length) || length === 0) return null;

  const clamped = Math.min(1, Math.max(0, t));
  const at = path.getPointAtLength(clamped * length);
  // A second sample a little along gives the heading, so the agent can face
  // the direction it is moving instead of sitting square on a corner.
  const step = Math.min(6, length / 20);
  const ahead = path.getPointAtLength(
    Math.min(length, clamped * length + step),
  );
  const behind = path.getPointAtLength(
    Math.max(0, clamped * length - step),
  );
  return {
    x: at.x,
    y: at.y,
    angle: (Math.atan2(ahead.y - behind.y, ahead.x - behind.x) * 180) / Math.PI,
  };
}
