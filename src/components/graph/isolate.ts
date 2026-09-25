import type { PipelineEdge } from "@/data/vtec/types";

/**
 * Everything upstream and downstream of one node.
 *
 * The two walks are deliberately separate, and this is the whole bug that was
 * here before. Growing a single set in both directions at once looks
 * equivalent and is not: from `variant D` it reaches `commit`, and then from
 * `commit` it reaches back down into every other variant, so the set closes
 * over the entire weakly-connected component. This graph is connected, so the
 * old version always kept all twenty nodes and dimmed nothing — hover
 * isolation was advertised in the README and had never done anything.
 *
 * Ancestors and descendants have to be collected apart, then unioned.
 */
export function isolatePath(
  edges: Pick<PipelineEdge, "source" | "target">[],
  id: string,
): Set<string> {
  const up = new Set<string>([id]);
  const down = new Set<string>([id]);

  for (;;) {
    let grew = false;
    for (const edge of edges) {
      if (down.has(edge.source) && !down.has(edge.target)) {
        down.add(edge.target);
        grew = true;
      }
      if (up.has(edge.target) && !up.has(edge.source)) {
        up.add(edge.source);
        grew = true;
      }
    }
    if (!grew) break;
  }

  return new Set([...up, ...down]);
}

/** An edge is on the path when both of its ends are. */
export function edgeOnPath(
  edge: Pick<PipelineEdge, "source" | "target">,
  keep: Set<string>,
): boolean {
  return keep.has(edge.source) && keep.has(edge.target);
}
