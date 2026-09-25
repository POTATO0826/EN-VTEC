"use client";

import * as React from "react";
import { BaseEdge, type Edge, type EdgeProps } from "@xyflow/react";
import { edgePath } from "./layout";
import type { FlowEdgeData } from "./types";

/**
 * A wire.
 *
 * Four states, none of them decorative: a wire says whether the work it carries
 * has not started, is happening, finished, or was abandoned. The travelling
 * pulse is a dash offset animated in CSS, so a graph full of live edges costs
 * the compositor and not the main thread.
 *
 * Geometry comes from the same `edgePath` the agent samples. That is not an
 * optimisation, it is the correctness condition: two implementations of the
 * curve would put the agent next to its cable instead of on it.
 */
export function PipelineEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
}: EdgeProps<Edge<FlowEdgeData>>) {
  const tone = data?.tone ?? "idle";
  const dimmed = data?.dimmed ?? false;
  const travelling = data?.travelling ?? false;

  const path = React.useMemo(
    () =>
      edgePath(
        { x: sourceX, y: sourceY },
        { x: targetX, y: targetY },
      ),
    [sourceX, sourceY, targetX, targetY],
  );

  return (
    <g
      className="vtec-wire"
      data-tone={tone}
      data-dimmed={dimmed ? "true" : "false"}
    >
      <BaseEdge id={id} path={path} interactionWidth={18} />
      {travelling ? (
        <path d={path} className="vtec-wire-pulse" fill="none" />
      ) : null}
    </g>
  );
}

export default PipelineEdge;
