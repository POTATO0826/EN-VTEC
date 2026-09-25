"use client";

import * as React from "react";
import { PinIcon, PinOffIcon } from "lucide-react";
import { medianFor } from "@/components/graph/metrics";
import { SectionLabel, StatusBadge } from "@/components/vtec/primitives";
import type { Journey } from "@/data/vtec/journey";
import { statusAtProgress } from "@/data/vtec/journey";
import type { PipelineNode, Run } from "@/data/vtec/types";
import { ms, num, pct } from "@/lib/format";

/**
 * The floating detail panel.
 *
 * It follows the agent unless something is pinned, so a run narrates itself
 * without anyone having to click. This replaces the old detail sheet rather
 * than joining it — two overlapping detail surfaces would be worse than one.
 */
export default function NodeInspector({
  run,
  journey,
  node,
  legIndex,
  pinned,
  onUnpin,
}: {
  run: Run;
  journey: Journey;
  node: PipelineNode | null;
  legIndex: number;
  pinned: boolean;
  onUnpin: () => void;
}) {
  if (!node) {
    return (
      <div className="vtec-hud vtec-hud-inspector">
        <SectionLabel>Inspector</SectionLabel>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Press <span className="text-foreground">Run proof</span> to watch the
          run, or click any module to pin it here.
        </p>
      </div>
    );
  }

  const status = statusAtProgress(node, journey, legIndex);
  const candidate = node.variant
    ? run.candidates.find((item) => item.variant === node.variant)
    : undefined;
  const settled =
    status !== "queued" && status !== "processing" && status !== "compiling";
  // The baseline has no candidate row and its gate carries no timings, so its
  // number comes from the curve. Everything else already has both.
  const curveMedian = node.timings ? null : medianFor(run, node.variant);

  return (
    <div className="vtec-hud vtec-hud-inspector">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <SectionLabel>{pinned ? "Pinned" : "Inspector"}</SectionLabel>
          <p className="mt-1.5 truncate text-sm font-medium text-foreground">
            {node.label}
          </p>
        </div>
        <button
          type="button"
          onClick={onUnpin}
          aria-label={pinned ? "Unpin, follow the agent" : "Nothing pinned"}
          disabled={!pinned}
          className="vtec-pin"
        >
          {pinned ? (
            <PinOffIcon className="size-3.5" />
          ) : (
            <PinIcon className="size-3.5" />
          )}
        </button>
      </div>

      <div className="flex items-center gap-2">
        <StatusBadge status={status} />
        <span className="vtec-kicker">{node.kind}</span>
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {status === "queued"
          ? "Not started."
          : status === "compiling"
            ? "Building the kernel."
            : status === "processing"
              ? "Running."
              : node.reason}
      </p>

      {settled && (node.timings || curveMedian !== null) ? (
        <div className="flex flex-col gap-1.5 border-t border-[var(--vtec-module-rule)] pt-3">
          <Row
            label="median"
            value={ms(node.timings?.medianMs ?? curveMedian ?? 0)}
            strong
          />
          {node.timings ? (
            <Row label="spread" value={ms(node.timings.stdevMs)} />
          ) : null}
          <Row label="noise band" value={pct(run.noiseBand)} />
          <Row label="job size" value={`${num(run.headlineJobSize)} messages`} />
          {candidate?.warmupMs !== undefined ? (
            <Row
              label="run 1 (warm-up, discarded)"
              value={ms(candidate.warmupMs)}
              muted
            />
          ) : null}
        </div>
      ) : null}

      {settled && (node.timings || candidate) ? (
        <details className="vtec-raw">
          <summary className="vtec-kicker cursor-pointer">raw</summary>
          <pre className="vtec-num mt-2 max-h-48 overflow-auto text-[10px] leading-relaxed text-muted-foreground">
            {JSON.stringify(
              candidate ? { node, candidate } : { node },
              null,
              2,
            )}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

function Row({
  label,
  value,
  strong = false,
  muted = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={
        muted
          ? "flex items-baseline justify-between gap-4 opacity-55"
          : "flex items-baseline justify-between gap-4"
      }
    >
      <span className="vtec-kicker">{label}</span>
      <span
        className={
          strong
            ? "vtec-num text-[11px] text-foreground"
            : "vtec-num text-[11px] text-muted-foreground"
        }
      >
        {value}
      </span>
    </div>
  );
}
