"use client";

import { CpuIcon } from "lucide-react";
import type { Node, NodeProps } from "@xyflow/react";
import { cn } from "cn";
import { VARIANTS } from "@/data/vtec/variants";
import { ms, pct } from "@/lib/format";
import { medianFor } from "../metrics";
import type { FlowNodeData, Metric } from "../types";
import { NodeShell } from "./NodeShell";

/**
 * One implementation of the task: the kernel module.
 *
 * This is the node the whole graph exists to choose between, so it is also
 * where the engage readout lives. The bar only appears on the variant the run
 * commits to, and only once that is settled — five idle bars would be noise,
 * one that snaps from NORMAL to VTEC is the moment.
 */
export function VariantNode({ data }: NodeProps<Node<FlowNodeData>>) {
  const { node, run, status } = data;
  const variant = node.variant;
  const candidate = variant
    ? run.candidates.find((item) => item.variant === variant)
    : undefined;
  const isBaseline = variant === run.plan.baselineVariant;
  const settled = status !== "queued" && status !== "compiling";
  const engaged = data.chosen && settled;

  // The baseline is timed but has no candidate row, so the curve is the source
  // of truth here and the candidate is only the faster path to the same number.
  const median = candidate?.medianMs ?? medianFor(run, variant);

  const metrics: Metric[] = [];
  if (!settled) {
    metrics.push({ label: "state", value: "compiling" });
  } else if (median === null || median === undefined) {
    metrics.push({ label: "median", value: "never timed" });
  } else {
    metrics.push({ label: "median", value: ms(median), strong: true });
    metrics.push({
      label: isBaseline ? "role" : "gain",
      value:
        isBaseline || candidate?.gainPct === undefined
          ? "baseline"
          : `${candidate.gainPct > 0 ? "+" : ""}${candidate.gainPct.toFixed(1)}% vs ${pct(run.noiseBand)}`,
    });
  }

  return (
    <NodeShell
      kicker={variant ? `variant ${variant}` : "variant"}
      title={variant ? VARIANTS[variant].label : node.label}
      icon={<CpuIcon className="size-3.5" />}
      status={status}
      dimmed={data.dimmed}
      active={data.active}
      inspected={data.inspected}
      chosen={data.chosen}
      emphasis={data.chosen}
      metrics={metrics}
      footer={data.chosen ? <EngageBar engaged={engaged} /> : undefined}
    />
  );
}

/**
 * NORMAL to VTEC. Futuristic rather than literal: a track, a travelling marker,
 * and the two words it moves between.
 */
function EngageBar({ engaged }: { engaged: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "vtec-kicker transition-colors duration-500",
            !engaged && "text-foreground",
          )}
        >
          normal
        </span>
        <span
          className={cn(
            "vtec-kicker transition-colors duration-500",
            engaged && "text-[var(--vtec-accent)]",
          )}
        >
          vtec
        </span>
      </div>
      <div className="vtec-engage-track">
        <span
          className={cn("vtec-engage-fill", engaged && "is-engaged")}
          aria-hidden
        />
      </div>
    </div>
  );
}

export default VariantNode;
