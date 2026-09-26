import { cn } from "cn";

const STYLES = {
  pending: { label: "pending", dot: "bg-muted-foreground", text: "text-muted-foreground" },
  verifying: { label: "verifying", dot: "bg-[var(--warning)] animate-pulse", text: "text-[var(--warning)]" },
  verified: { label: "verified", dot: "bg-[var(--success)]", text: "text-[var(--success)]" },
  rejected: { label: "rejected", dot: "bg-[var(--danger)]", text: "text-[var(--danger)]" },
} as const;

export type Status = keyof typeof STYLES;

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  const s = STYLES[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border/70 px-2 py-0.5 text-xs",
        s.text,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}
