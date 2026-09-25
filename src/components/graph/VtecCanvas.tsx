"use client";

import * as React from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Journey } from "@/data/vtec/journey";
import { statusAtProgress } from "@/data/vtec/journey";
import type { Pipeline } from "@/data/vtec";
import type { PipelineNode, Run } from "@/data/vtec/types";
import type { PipelineRun } from "@/hooks/usePipelineRun";
import { edgeOnPath, isolatePath } from "./isolate";
import { NODE_H, NODE_W, layoutPipeline } from "./layout";
import PipelineAgent from "./PipelineAgent";
import PipelineEdgeComponent from "./PipelineEdge";
import { ChainNode } from "./nodes/ChainNode";
import { EnsNode } from "./nodes/EnsNode";
import { GateNode } from "./nodes/GateNode";
import { PlanNode } from "./nodes/PlanNode";
import { RegistryNode } from "./nodes/RegistryNode";
import { SkipNode } from "./nodes/SkipNode";
import { VariantNode } from "./nodes/VariantNode";
import type { EdgeTone, FlowEdgeData, FlowNodeData } from "./types";

const nodeTypes = {
  plan: PlanNode,
  chain: ChainNode,
  variant: VariantNode,
  gate: GateNode,
  registry: RegistryNode,
  ens: EnsNode,
  skip: SkipNode,
};

const edgeTypes = { wire: PipelineEdgeComponent };

function nodeTypeFor(node: PipelineNode): keyof typeof nodeTypes {
  if (node.id === "plan") return "plan";
  if (node.id.startsWith("skip-")) return "skip";
  switch (node.kind) {
    case "commit":
      return "chain";
    case "variant":
      return "variant";
    case "registry":
      return "registry";
    case "ens":
      return "ens";
    default:
      return "gate";
  }
}

/* -------------------------------------------------------------------------- */
/* Canvas                                                                      */
/* -------------------------------------------------------------------------- */

export default function VtecCanvas({
  run,
  pipeline,
  journey,
  pipelineRun,
  inspectedId,
  onInspect,
  onActiveNode,
  layoutSignal,
}: {
  run: Run;
  pipeline: Pipeline;
  journey: Journey;
  pipelineRun: PipelineRun;
  inspectedId: string | null;
  onInspect: (id: string | null) => void;
  onActiveNode: (id: string | null) => void;
  /** Bumped by RESET to put dragged nodes back and refit the viewport. */
  layoutSignal: number;
}) {
  const { setCenter, fitView } = useReactFlow();
  const { legIndex, phase, follow, setFollow } = pipelineRun;

  const nodeById = React.useMemo(() => {
    const map = new Map<string, PipelineNode>();
    for (const node of pipeline.nodes) map.set(node.id, node);
    return map;
  }, [pipeline.nodes]);

  const positions = React.useMemo(
    () => layoutPipeline(pipeline.nodes, pipeline.edges),
    [pipeline],
  );

  /**
   * Seeded once, then never written again by the status pipeline.
   *
   * The previous version rebuilt every node from the layout map on every tick,
   * which is why dragging had to be switched off: a dragged node snapped home
   * on the next tick. Updates below touch `data` only.
   */
  const initialNodes = React.useMemo<Node<FlowNodeData>[]>(
    () =>
      pipeline.nodes.map((node) => ({
        id: node.id,
        type: nodeTypeFor(node),
        position: positions.get(node.id) ?? { x: 0, y: 0 },
        data: {
          node,
          run,
          status: "queued",
          dimmed: false,
          active: false,
          inspected: false,
          chosen: node.variant === journey.selected,
        },
      })),
    [pipeline.nodes, positions, run, journey.selected],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);

  // A different result means a different graph, not a moved one.
  React.useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

  const [hovered, setHovered] = React.useState<string | null>(null);
  const keep = React.useMemo(
    () => (hovered ? isolatePath(pipeline.edges, hovered) : null),
    [hovered, pipeline.edges],
  );

  /** The leg in flight, and the node the agent has most recently reached. */
  const inFlight = legIndex > 0 ? journey.legs[legIndex - 1] : null;
  const activeNodeId = inFlight
    ? inFlight.reverse
      ? inFlight.source
      : inFlight.target
    : null;

  React.useEffect(() => {
    onActiveNode(activeNodeId);
  }, [activeNodeId, onActiveNode]);

  /* Node faces. Recomputed per leg — roughly thirty times in a run — never per
     frame. Unchanged nodes keep their object identity so React Flow skips them. */
  React.useEffect(() => {
    setNodes((current) =>
      current.map((flowNode) => {
        const node = nodeById.get(flowNode.id);
        if (!node) return flowNode;
        const status = statusAtProgress(node, journey, legIndex);
        const dimmed = keep ? !keep.has(flowNode.id) : false;
        const active = activeNodeId === flowNode.id;
        const inspected = inspectedId === flowNode.id;
        const data = flowNode.data;
        if (
          data.status === status &&
          data.dimmed === dimmed &&
          data.active === active &&
          data.inspected === inspected
        ) {
          return flowNode;
        }
        return {
          ...flowNode,
          data: { ...data, status, dimmed, active, inspected },
        };
      }),
    );
  }, [legIndex, keep, activeNodeId, inspectedId, journey, nodeById, setNodes]);

  /* Wires. A wire that no leg ever travels is not idle, it is abandoned — the
     losing gates' run to the registry, and the sizes that were never attempted. */
  const edgeArrival = React.useMemo(() => {
    const map = new Map<string, number>();
    journey.legs.forEach((leg, index) => {
      if (!leg.reverse && !map.has(leg.edgeId)) map.set(leg.edgeId, index + 1);
    });
    return map;
  }, [journey.legs]);

  const edges = React.useMemo<Edge<FlowEdgeData>[]>(() => {
    const travellingEdgeId =
      (phase === "running" || phase === "paused") && inFlight
        ? inFlight.edgeId
        : null;

    return pipeline.edges.map((edge) => {
      const arrival = edgeArrival.get(edge.id);
      let tone: EdgeTone;
      if (arrival === undefined) {
        const sourceArrival = journey.arrival.get(edge.source) ?? Infinity;
        tone = legIndex >= sourceArrival ? "dead" : "idle";
      } else if (legIndex >= arrival) {
        tone = "done";
      } else if (legIndex >= arrival - 1) {
        tone = "active";
      } else {
        tone = "idle";
      }

      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: "wire",
        data: {
          tone,
          dimmed: keep ? !edgeOnPath(edge, keep) : false,
          travelling: travellingEdgeId === edge.id,
        },
      };
    });
  }, [pipeline.edges, edgeArrival, journey.arrival, legIndex, keep, phase, inFlight]);

  /* Camera. Moved once per leg, not once per frame: a locked chase cam on a
     graph this size reads as motion sickness. Return legs are skipped so
     backing out of a dead branch does not yank the viewport. */
  React.useEffect(() => {
    if (!follow || phase !== "running" || !inFlight || inFlight.reverse) return;
    const source = positions.get(inFlight.source);
    const target = positions.get(inFlight.target);
    if (!source || !target) return;
    setCenter(
      (source.x + target.x) / 2 + NODE_W / 2,
      (source.y + target.y) / 2 + NODE_H / 2,
      { zoom: inFlight.phase === "select" ? 1 : 0.85, duration: 620 },
    );
  }, [follow, phase, inFlight, positions, setCenter]);

  /* Dragged nodes stay where they were put. RESET is the one thing that puts
     them back, and it refits the viewport so the whole graph is on screen. */
  const firstLayout = React.useRef(true);
  React.useEffect(() => {
    if (firstLayout.current) {
      firstLayout.current = false;
      return;
    }
    setNodes(initialNodes);
    const timer = window.setTimeout(
      () => fitView({ padding: 0.06, maxZoom: 1, duration: 520 }),
      0,
    );
    return () => window.clearTimeout(timer);
    // Only the signal should trigger this; re-seeding on graph change is the
    // effect above, and that one must not animate the viewport.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutSignal]);

  return (
    <div className="vtec-canvas h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.06, maxZoom: 1 }}
        minZoom={0.15}
        maxZoom={2}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        panOnScroll={false}
        zoomOnScroll
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
        onMoveStart={(event) => {
          // A null event is our own camera move. Anything else is the user
          // taking the wheel, and the camera should let go.
          if (event && follow) setFollow(false);
        }}
        onNodeMouseEnter={(_event, node) => setHovered(node.id)}
        onNodeMouseLeave={() => setHovered(null)}
        onNodeClick={(_event, node) =>
          onInspect(inspectedId === node.id ? null : node.id)
        }
        onPaneClick={() => onInspect(null)}
      >
        <Background
          id="vtec-dots"
          variant={BackgroundVariant.Dots}
          gap={28}
          size={1}
          color="var(--vtec-grid-dot)"
        />
        <Background
          id="vtec-lines"
          variant={BackgroundVariant.Lines}
          gap={140}
          lineWidth={1}
          color="var(--vtec-grid-line)"
        />
        <Controls
          showInteractive={false}
          position="bottom-right"
          className="vtec-controls"
        />
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          className="vtec-minimap"
          style={{ width: 176, height: 116 }}
          maskColor="rgba(4, 4, 6, 0.66)"
          nodeStrokeWidth={0}
          nodeBorderRadius={2}
          nodeColor={(node) => {
            const data = node.data as FlowNodeData;
            switch (data?.status) {
              case "accepted":
                return "var(--success)";
              case "failed":
                return "var(--danger)";
              case "rejected":
                return "var(--warning)";
              case "queued":
              case "skipped":
                return "#3a3a44";
              case "compiling":
              case "processing":
                return "var(--vtec-accent)";
              default:
                return "#8b8b96";
            }
          }}
        />
        <PipelineAgent journey={journey} run={pipelineRun} />
      </ReactFlow>
    </div>
  );
}
