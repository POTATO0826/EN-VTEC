import * as React from "react";
import { cn } from "cn";
import { CheckIcon } from "lucide-react";

export type StepState = "locked" | "active" | "done";

/** One numbered step on a page. Locked steps stay visible but dimmed. */
export function Step({
  n,
  title,
  summary,
  state,
  children,
}: {
  n: number;
  title: string;
  /** One line shown once the step is done, in place of its body. */
  summary?: React.ReactNode;
  state: StepState;
  children?: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border bg-card/60 p-5 backdrop-blur-sm transition-opacity md:p-6",
        state === "active" ? "border-border" : "border-border/50",
        state === "locked" && "opacity-50",
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "inline-flex size-7 shrink-0 items-center justify-center rounded-full border text-xs",
            state === "active" && "border-primary text-primary",
            state === "done" && "border-transparent bg-[var(--success)] text-black",
            state === "locked" && "border-border text-muted-foreground",
          )}
        >
          {state === "done" ? <CheckIcon className="size-3.5" /> : n}
        </span>
        <h2 className="text-base font-medium">{title}</h2>
        {state === "done" && summary ? (
          <span className="ml-auto truncate text-sm text-muted-foreground">{summary}</span>
        ) : null}
      </div>
      {state === "active" && children ? <div className="mt-5">{children}</div> : null}
    </section>
  );
}

export function PageTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-8">
      <h1 className="text-3xl font-medium tracking-tight md:text-4xl">{title}</h1>
      <p className="mt-2 max-w-2xl text-base text-muted-foreground">{subtitle}</p>
    </div>
  );
}
