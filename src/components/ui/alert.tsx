import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

const alertVariants = cva(
  "relative grid w-full grid-cols-[0_1fr] items-start gap-y-1 rounded-xl border border-border/60 px-5 py-4 text-sm has-[>svg]:grid-cols-[calc(var(--spacing)*5)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5",
  {
    variants: {
      variant: {
        default: "bg-card/40 text-foreground [&>svg]:text-muted-foreground",
        warning:
          "border-[color-mix(in_oklab,var(--warning)_40%,transparent)] bg-[color-mix(in_oklab,var(--warning)_8%,transparent)] text-foreground [&>svg]:text-[var(--warning)]",
        danger:
          "border-[color-mix(in_oklab,var(--danger)_40%,transparent)] bg-[color-mix(in_oklab,var(--danger)_8%,transparent)] text-foreground [&>svg]:text-[var(--danger)]",
        success:
          "border-[color-mix(in_oklab,var(--success)_40%,transparent)] bg-[color-mix(in_oklab,var(--success)_8%,transparent)] text-foreground [&>svg]:text-[var(--success)]",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "col-start-2 min-h-4 font-medium tracking-tight text-foreground",
        className,
      )}
      {...props}
    />
  );
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "col-start-2 grid justify-items-start gap-2 text-sm leading-relaxed text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { Alert, AlertTitle, AlertDescription };
