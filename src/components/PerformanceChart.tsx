"use client";
import { Card } from "./ui/card";
import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceDot,
} from "recharts";
import { ChartNoAxesCombined, ArrowDown } from "lucide-react";
import {
  CHART_POINTS,
  VARIANTS,
  WORKLOADS,
  batchLabel,
  type GpuId,
  type WorkloadSize,
  type VariantId,
} from "../data/mockGpuData";

export default function PerformanceChart({
  gpu,
  workload,
}: {
  gpu: GpuId;
  workload: WorkloadSize;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const points = CHART_POINTS[gpu];
  const batch = WORKLOADS.find((item) => item.id === workload)!.batch;
  const point = points.find((item) => item.batch === batch)!;
  const series = [
    { key: "baseline", label: "Baseline", color: "#69737d" },
    ...(Object.keys(VARIANTS) as VariantId[]).map((id) => ({
      key: id,
      label: `Variant ${id}`,
      color: VARIANTS[id].color,
    })),
    { key: "vtec", label: "VTEC selected", color: "#e8f0e3" },
  ];
  return (
    <Card
      className="performance-panel"
      id="performance"
      aria-labelledby="chart-title"
    >
      <div className="panel-heading">
        <h2 id="chart-title">
          <ChartNoAxesCombined size={16} /> Latency by workload
        </h2>
        <span className="micro flex items-center gap-1">
          <ArrowDown size={11} /> Lower is better
        </span>
      </div>
      <div className="chart-subheading">
        <p>Latency vs. workload size</p>
        <span className="micro">
          {gpu === "rtx3050" ? "RTX 3050 LAPTOP" : "RTX 4060"} · mock benchmark
        </span>
      </div>
      <div className="chart-legend" aria-label="Chart series">
        {series.map((line) => (
          <button
            key={line.key}
            onMouseEnter={() => setHovered(line.key)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(line.key)}
            onBlur={() => setHovered(null)}
            className={line.key === "vtec" ? "vtec-legend" : ""}
          >
            <i style={{ background: line.color }} />
            {line.label}
          </button>
        ))}
      </div>
      <div className="chart-axis-caption micro">Latency (ms)</div>
      <div
        className="performance-chart"
        role="img"
        aria-label={`Mock latency curves for ${gpu}. At batch ${batchLabel(batch)}, VTEC selects ${point.vtec.toFixed(1)} milliseconds. Lines cross as different variants win at different sizes.`}
      >
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <LineChart
            data={points}
            margin={{ top: 15, right: 25, bottom: 2, left: -20 }}
          >
            <CartesianGrid
              vertical={false}
              stroke="#272d33"
              strokeDasharray="2 5"
            />
            <XAxis
              dataKey="batch"
              tickFormatter={batchLabel}
              tick={{
                fill: "#8e969f",
                fontSize: 12,
                fontFamily: "Geist Mono, monospace",
              }}
              tickLine={false}
              axisLine={{ stroke: "#30363d" }}
              padding={{ left: 14, right: 10 }}
              minTickGap={14}
            />
            <YAxis
              tick={{
                fill: "#8e969f",
                fontSize: 12,
                fontFamily: "Geist Mono, monospace",
              }}
              tickLine={false}
              axisLine={false}
              domain={[0, 28]}
              ticks={[0, 7, 14, 21, 28]}
            />
            <Tooltip
              contentStyle={{
                background: "#11161a",
                border: "1px solid #343c44",
                borderRadius: 5,
                fontSize: 12,
                fontFamily: "Geist Mono, monospace",
              }}
              labelStyle={{ color: "#e9edef", marginBottom: 8 }}
              labelFormatter={(value) => `Batch ${batchLabel(Number(value))}`}
              formatter={(value, name) => [
                `${Number(value).toFixed(2)} ms`,
                name,
              ]}
            />
            <ReferenceLine x={batch} stroke="#9ea99b" strokeDasharray="4 5" />
            {series.map((line) => (
              <Line
                key={line.key}
                dataKey={line.key}
                name={line.label}
                type="linear"
                stroke={line.color}
                strokeWidth={line.key === "vtec" ? 3 : 1.6}
                strokeDasharray={
                  line.key === "baseline"
                    ? "5 5"
                    : line.key === "vtec"
                      ? "3 5"
                      : undefined
                }
                strokeOpacity={
                  hovered && hovered !== line.key
                    ? 0.18
                    : line.key === "vtec"
                      ? 1
                      : 0.8
                }
                dot={false}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            ))}
            <ReferenceDot
              x={batch}
              y={point.vtec}
              r={6}
              fill="#fafafa"
              stroke="#0c1110"
              strokeWidth={3}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-bottom">
        <span className="micro">Batch size · categorical spacing</span>
        <span>
          <i /> VTEC follows the fastest valid kernel.
        </span>
      </div>
      <p className="chart-insight">
        The selected trajectory follows the fastest valid result.{" "}
        <span>Results vary with hardware and batch size.</span>
      </p>
    </Card>
  );
}
