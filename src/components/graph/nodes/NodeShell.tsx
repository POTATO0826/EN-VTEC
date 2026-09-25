"use client";

import * as React from "react";
import { Handle, Position } from "@xyflow/react";
import { cn } from "cn";
import { StatusBadge } from "@/components/vtec/primitives";
import type { NodeStatus } from "@/data/vtec/types";
import { NODE_H, NODE_W } from "../layout";
import type { Metric } from "../types";

/**
 * The chrome every operator module shares.
 *
 * One card treatment, one set of ports, one status corner. The per-kind
 * components below it only decide what goes on the face, which is the whole
 * point of having this: a new node kind is a title, an icon and some rows.
 */
export function NodeShell({
  kicker,
  title,
  icon,
  status,
  metrics,
  footer,
  dimmed = false,
  active = false,
  inspected = false,
  chosen = false,
  emphasis = false,
  hasInput = true,
  hasOutput = true,
}: {
  kicker: string;
  title: React.ReactNode;
  icon: React.ReactNode;
  status: NodeStatus;
  metrics?: Metric[];
  footer?: React.ReactNode;
  dimmed?: boolean;
  active?: boolean;
  inspected?: boolean;
  chosen?: boolean;
  /** Reserved for the modules the run turns on: heavier frame, brighter title. */
  emphasis?: boolean;
  hasInput?: boolean;
  hasOutput?: boolean;
}) {
  return (
    <div
      style={{ width: NODE_W, minHeight: NODE_H }}
      data-status={status}
      data-emphasis={emphasis ? "true" : undefined}
      data-chosen={chosen ? "true" : undefined}
      data-active={active ? "true" : undefined}
      data-inspected={inspected ? "true" : undefined}
      data-dimmed={dimmed ? "true" : undefined}
      className={cn(
        "vtec-module relative flex flex-col rounded-lg border",
        (status === "processing" || status === "compiling") && "vtec-pulse",
      )}
    >
      {hasInput ? (
        <Handle type="target" position={Position.Left} className="vtec-port" />
      ) : null}

      <div className="flex items-center gap-2 px-3 pt-2.5 pb-2">
        <span className="vtec-module-icon">{icon}</span>
        <span className="vtec-kicker flex-1 truncate">{kicker}</span>
        <StatusBadge status={status} className="shrink-0" />
      </div>

      <div className="px-3 pb-2.5">
        <p className="text-[13px] leading-snug font-medium text-foreground">
          {title}
        </p>
      </div>

      {metrics && metrics.length > 0 ? (
        <div className="mt-auto flex flex-col border-t border-[var(--vtec-module-rule)] px-3 py-1.5">
          {metrics.map((metric) => (
            <div
              key={metric.label}
              className="flex items-baseline justify-between gap-3 py-[3px]"
            >
              <span className="vtec-kicker">{metric.label}</span>
              <span
                className={cn(
                  "vtec-num text-[11px]",
                  metric.strong ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {metric.value}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {footer ? (
        <div className="mt-auto border-t border-[var(--vtec-module-rule)] px-3 py-2">
          {footer}
        </div>
      ) : null}

      {hasOutput ? (
        <Handle type="source" position={Position.Right} className="vtec-port" />
      ) : null}
    </div>
  );
}
