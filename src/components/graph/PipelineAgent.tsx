"use client";

import * as React from "react";
import { ViewportPortal, useStoreApi } from "@xyflow/react";
import { ZapIcon } from "lucide-react";
import type { Journey } from "@/data/vtec/journey";
import { legAtProgress } from "@/data/vtec/journey";
import type { PipelineRun } from "@/hooks/usePipelineRun";
import { edgePath, handleAnchor, pointOnPath } from "./layout";

/**
 * The thing that travels.
 *
 * It renders inside the viewport portal, so it shares the canvas coordinate
 * system and pans and zooms for free, and it is moved by writing a transform to
 * its own element rather than through state. That is the whole reason a
 * thirty-leg run at sixty frames a second costs nothing: React never hears
 * about any of it, and the twenty node components never re-render.
 *
 * Node positions are read out of the store on each frame, so the agent stays
 * glued to its wire even while the node at the far end is being dragged.
 */
export function PipelineAgent({
  journey,
  run,
}: {
  journey: Journey;
  run: PipelineRun;
}) {
  const store = useStoreApi();
  const cacheRef = React.useRef<{ key: string; path: string } | null>(null);
  // A callback ref rather than a plain one: the viewport portal renders nothing
  // until the flow has mounted its own container, so the element arrives a
  // commit later than this component does and an effect on a plain ref would
  // subscribe to nothing and never retry.
  const [element, setElement] = React.useState<HTMLDivElement | null>(null);

  const { subscribe } = run;

  React.useEffect(() => {
    if (!element) return;

    const place = (progress: number) => {
      const at = legAtProgress(journey, progress);
      if (!at) {
        element.style.opacity = "0";
        return;
      }

      const { nodeLookup } = store.getState();
      const { leg, t } = at;
      // A return leg travels the same wire the other way, so the agent walks
      // it from 1 back to 0 rather than getting a second set of geometry.
      const from = handleAnchor(nodeLookup.get(leg.source), "source");
      const to = handleAnchor(nodeLookup.get(leg.target), "target");
      if (!from || !to) {
        element.style.opacity = "0";
        return;
      }

      const key = `${leg.edgeId}|${from.x},${from.y}|${to.x},${to.y}`;
      if (cacheRef.current?.key !== key) {
        cacheRef.current = { key, path: edgePath(from, to) };
      }
      const point = pointOnPath(
        cacheRef.current.path,
        leg.reverse ? 1 - t : t,
      );
      if (!point) {
        element.style.opacity = "0";
        return;
      }

      element.style.opacity = "1";
      element.style.transform = `translate(${point.x}px, ${point.y}px) translate(-50%, -50%)`;
      element.dataset.phase = leg.phase;
    };

    return subscribe(place);
  }, [element, journey, store, subscribe]);

  return (
    <ViewportPortal>
      <div ref={setElement} className="vtec-agent" data-phase="open">
        <span className="vtec-agent-halo" aria-hidden />
        <span className="vtec-agent-core">
          <ZapIcon className="size-3" strokeWidth={2.5} />
        </span>
      </div>
    </ViewportPortal>
  );
}

export default PipelineAgent;
