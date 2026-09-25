"use client";

import * as React from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartRows, timedVariants, winnerAtSize } from "@/data/vtec";
import type { Run, VariantId } from "@/data/vtec/types";
import { VARIANTS, variantName } from "@/data/vtec/variants";
import { ms, num } from "@/lib/format";

const SERIES_COLOR: Record<VariantId, string> = {
  A: "var(--chart-a)",
  B: "var(--chart-b)",
  C: "var(--chart-c)",
  D: "var(--chart-d)",
  E: "var(--chart-e)",
};

type TooltipPayload = {
  dataKey?: string | number;
  value?: number;
};

function ChartTooltip({
  active,
  payload,
  label,
  run,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: number | string;
  run: Run;
}) {
  if (!active || !payload?.length) return null;
  const jobSize = Number(label);
  const winner = winnerAtSize(run, jobSize);

  const rows = payload
    .filter((item) => item.dataKey !== "dispatcher")
    .sort((a, b) => (a.value ?? 0) - (b.value ?? 0));

  return (
    <div className="rounded-lg border border-border/60 bg-popover px-3 py-2.5 text-xs">
      <div className="vtec-num mb-2 text-foreground">
        job: {num(jobSize)} messages
      </div>
      <div className="flex flex-col gap-1">
        {rows.map((item) => {
          const variant = String(item.dataKey) as VariantId;
          const isWinner = winner?.variant === variant;
          return (
            <div
              key={variant}
              className="flex items-center justify-between gap-6"
            >
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="inline-block size-2 rounded-full"
                  style={{ background: SERIES_COLOR[variant] }}
                />
                <span
                  className={
                    isWinner ? "text-foreground" : "text-muted-foreground"
                  }
                >
                  {variantName(variant)}
                </span>
              </span>
              <span className="vtec-num">{ms(item.value ?? 0)}</span>
            </div>
          );
        })}
      </div>
      {winner ? (
        <div className="mt-2 border-t border-border/40 pt-2 text-muted-foreground">
          Dispatcher picks variant {winner.variant} — {VARIANTS[winner.variant].label}
        </div>
      ) : null}
    </div>
  );
}

export function LatencyChart({ run }: { run: Run }) {
  const rows = React.useMemo(() => chartRows(run), [run]);
  const variants = React.useMemo(() => timedVariants(run), [run]);
  const sizes = rows.map((row) => row.jobSize);

  return (
    <div className="flex flex-col gap-4">
      <div className="h-[340px] w-full md:h-[420px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={rows}
            margin={{ top: 8, right: 16, bottom: 8, left: 4 }}
          >
            <CartesianGrid
              stroke="var(--border)"
              strokeDasharray="2 4"
              vertical={false}
            />
            <XAxis
              dataKey="jobSize"
              type="number"
              scale="log"
              domain={[sizes[0], sizes[sizes.length - 1]]}
              ticks={sizes}
              tickFormatter={(value: number) => num(value)}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              height={36}
            />
            <YAxis
              tickFormatter={(value: number) => `${value}`}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={48}
              label={{
                value: "median ms",
                angle: -90,
                position: "insideLeft",
                style: { fill: "var(--muted-foreground)", fontSize: 11 },
              }}
            />
            <Tooltip
              cursor={{ stroke: "var(--border)" }}
              content={<ChartTooltip run={run} />}
            />
            {variants.map((variant) => (
              <Line
                key={variant}
                type="monotone"
                dataKey={variant}
                stroke={SERIES_COLOR[variant]}
                strokeWidth={1.75}
                dot={{ r: 2.5, strokeWidth: 0, fill: SERIES_COLOR[variant] }}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            ))}
            <Line
              type="monotone"
              dataKey="dispatcher"
              stroke="var(--chart-dispatcher)"
              strokeWidth={1.5}
              strokeDasharray="5 4"
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
        {variants.map((variant) => (
          <span key={variant} className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block h-0.5 w-5"
              style={{ background: SERIES_COLOR[variant] }}
            />
            <span className="text-muted-foreground">
              {variantName(variant)}
            </span>
          </span>
        ))}
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block h-0.5 w-5"
            style={{
              backgroundImage:
                "repeating-linear-gradient(90deg, var(--chart-dispatcher) 0 5px, transparent 5px 9px)",
            }}
          />
          <span className="text-muted-foreground">
            dispatcher — what the registry selects at each job size
          </span>
        </span>
      </div>
    </div>
  );
}

export default LatencyChart;
