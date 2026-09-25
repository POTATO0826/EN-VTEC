"use client";

import * as React from "react";
import { cn } from "cn";
import { CheckIcon, CopyIcon, InfoIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { NodeStatus, ResultStatus, VariantId } from "@/data/vtec/types";
import { VARIANTS } from "@/data/vtec/variants";
import { pct, shortHash, speedup as fmtSpeedup } from "@/lib/format";

/* -------------------------------------------------------------------------- */
/* Surfaces                                                                    */
/* -------------------------------------------------------------------------- */

/** The one card treatment: flat, generous, no shadow, no gradient. */
export function Panel({
  className,
  ...props
}: React.ComponentProps<typeof Card>) {
  return (
    <Card
      className={cn(
        "gap-6 rounded-xl border-border/60 bg-card/40 p-6 shadow-none md:p-8",
        className,
      )}
      {...props}
    />
  );
}

export function SectionLabel({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "text-xs tracking-[0.2em] text-muted-foreground uppercase",
        className,
      )}
      {...props}
    />
  );
}

export function Pill({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 text-xs text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function StatusDot({
  tone = "muted",
  className,
}: {
  tone?: "success" | "warning" | "danger" | "info" | "muted";
  className?: string;
}) {
  const color =
    tone === "muted" ? "var(--muted-foreground)" : `var(--${tone})`;
  return (
    <span
      aria-hidden
      className={cn("inline-block size-1.5 shrink-0 rounded-full", className)}
      style={{ background: color }}
    />
  );
}

/** Tiny uppercase label on the left, status dot plus one word on the right. */
export function PanelHeader({
  label,
  state,
  tone = "muted",
}: {
  label: string;
  state: string;
  tone?: "success" | "warning" | "danger" | "info" | "muted";
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <SectionLabel>{label}</SectionLabel>
      <span className="flex items-center gap-2 text-xs tracking-[0.2em] text-muted-foreground uppercase">
        <StatusDot tone={tone} />
        {state}
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Vocabulary                                                                  */
/* -------------------------------------------------------------------------- */

/** A variant always arrives with its plain name. There is no short form. */
export function VariantName({
  id,
  className,
  muted = false,
}: {
  id: VariantId;
  className?: string;
  muted?: boolean;
}) {
  return (
    <span className={cn("whitespace-nowrap", className)}>
      <span className="font-medium">variant {id}</span>
      <span className={muted ? "text-muted-foreground" : undefined}>
        {" "}
        — {VARIANTS[id].label}
      </span>
    </span>
  );
}

/** A speedup never appears without the band it had to clear. */
export function SpeedupWithBand({
  value,
  noiseBand,
  className,
}: {
  value: number;
  noiseBand: number;
  className?: string;
}) {
  return (
    <span className={cn("whitespace-nowrap", className)}>
      <span className="vtec-num">{fmtSpeedup(value)}</span>
      <span className="text-muted-foreground"> baseline · noise band </span>
      <span className="vtec-num text-muted-foreground">{pct(noiseBand)}</span>
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Status badges                                                               */
/* -------------------------------------------------------------------------- */

const NODE_STATUS_STYLE: Record<
  NodeStatus,
  { className: string; label: string }
> = {
  queued: {
    label: "queued",
    className:
      "border-dashed border-border/60 bg-transparent text-muted-foreground",
  },
  compiling: {
    label: "compiling",
    className: "border-border/60 bg-transparent text-muted-foreground",
  },
  processing: {
    label: "processing",
    className:
      "border-[color-mix(in_oklab,var(--info)_50%,transparent)] bg-transparent text-[var(--info)]",
  },
  passed: {
    label: "passed",
    className: "border-border/60 bg-secondary text-foreground",
  },
  accepted: {
    label: "accepted",
    className:
      "border-[color-mix(in_oklab,var(--success)_45%,transparent)] bg-[color-mix(in_oklab,var(--success)_14%,transparent)] text-[var(--success)]",
  },
  rejected: {
    label: "rejected",
    className:
      "border-[color-mix(in_oklab,var(--warning)_45%,transparent)] bg-[color-mix(in_oklab,var(--warning)_12%,transparent)] text-[var(--warning)]",
  },
  failed: {
    label: "failed",
    className:
      "border-[color-mix(in_oklab,var(--danger)_45%,transparent)] bg-[color-mix(in_oklab,var(--danger)_12%,transparent)] text-[var(--danger)]",
  },
  skipped: {
    label: "skipped",
    className:
      "border-dashed border-border/60 bg-transparent text-muted-foreground",
  },
  published: {
    label: "published",
    className:
      "border-transparent bg-[color-mix(in_oklab,var(--info)_22%,transparent)] text-foreground",
  },
};

export function nodeStatusClass(status: NodeStatus) {
  return NODE_STATUS_STYLE[status].className;
}

export function StatusBadge({
  status,
  className,
}: {
  status: NodeStatus;
  className?: string;
}) {
  const style = NODE_STATUS_STYLE[status];
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-md px-2 py-0.5 text-[11px] font-normal tracking-wide lowercase",
        style.className,
        className,
      )}
    >
      {style.label}
    </Badge>
  );
}

export function ResultStatusBadge({
  status,
  className,
}: {
  status: ResultStatus;
  className?: string;
}) {
  const map: Record<ResultStatus, { label: string; status: NodeStatus }> = {
    verified: { label: "verified", status: "accepted" },
    "no-winner": { label: "no winner", status: "rejected" },
    running: { label: "running", status: "processing" },
  };
  const entry = map[status];
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-md px-2 py-0.5 text-[11px] font-normal tracking-wide lowercase",
        NODE_STATUS_STYLE[entry.status].className,
        className,
      )}
    >
      {entry.label}
    </Badge>
  );
}

/* -------------------------------------------------------------------------- */
/* Small utilities                                                             */
/* -------------------------------------------------------------------------- */

export function InfoTip({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="text-muted-foreground/70 transition-colors hover:text-foreground"
          aria-label="What this means"
        >
          <InfoIcon className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{children}</TooltipContent>
    </Tooltip>
  );
}

export function CopyButton({
  value,
  label = "Copy",
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);

  const copy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }, [value]);

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground",
        className,
      )}
    >
      {copied ? (
        <CheckIcon className="size-3" />
      ) : (
        <CopyIcon className="size-3" />
      )}
      {copied ? "Copied" : label}
    </button>
  );
}

export function HashChip({
  value,
  lead = 10,
  tail = 6,
  copyable = true,
  className,
}: {
  value: string;
  lead?: number;
  tail?: number;
  copyable?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <code
        className="vtec-num text-xs text-muted-foreground"
        title={value}
      >
        {shortHash(value, lead, tail)}
      </code>
      {copyable ? <CopyButton value={value} label="Copy" /> : null}
    </span>
  );
}

/** Label / value row used in every read-only spec list. */
export function SpecRow({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-6 border-b border-border/40 py-2.5 last:border-b-0",
        className,
      )}
    >
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right text-sm text-foreground">{children}</span>
    </div>
  );
}

/** The numbered marker used by the rail and by every sub-action card. */
export function NumberMarker({
  n,
  state = "future",
  className,
}: {
  n: number;
  state?: "future" | "active" | "complete";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-full border text-xs",
        state === "active" &&
          "border-primary text-primary ring-2 ring-primary/70",
        state === "complete" && "border-transparent bg-muted text-foreground",
        state === "future" && "border-border/60 text-muted-foreground",
        className,
      )}
    >
      {state === "complete" ? <CheckIcon className="size-3.5" /> : n}
    </span>
  );
}

/** Icon container for a feature row. No border on the row itself, only spacing. */
export function FeatureIcon({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/60 text-muted-foreground [&>svg]:size-[18px]",
        className,
      )}
    >
      {children}
    </span>
  );
}
