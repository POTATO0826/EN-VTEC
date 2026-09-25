"use client";
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from "./ui/table";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Database, ArrowUpRight } from "lucide-react";
import {
  GPUS,
  WORKLOADS,
  BENCHMARKS,
  REGISTRY,
  VARIANTS,
  speedup,
  batchLabel,
  type GpuId,
  type WorkloadSize,
} from "../data/mockGpuData";

export default function RegistryTable({
  gpu,
  workload,
  onSelect,
}: {
  gpu: GpuId;
  workload: WorkloadSize;
  onSelect: (gpu: GpuId, workload: WorkloadSize) => void;
}) {
  return (
    <Card
      className="registry-panel"
      id="registry"
      aria-labelledby="registry-title"
    >
      <div className="panel-heading">
        <h2 id="registry-title">
          <Database size={15} /> Optimization Registry
        </h2>
        <span className="micro">{REGISTRY.length} verified results</span>
      </div>
      <p className="panel-caption">Select a result to view its attestation.</p>
      <div className="table-scroll">
        <Table className="registry-table">
          <TableHeader>
            <TableRow>
              <TableHead>Workload</TableHead>
              {GPUS.map((item) => (
                <TableHead key={item.id}>
                  <strong>{item.name}</strong>
                  <span>
                    {item.vram} GB / {item.sm} SM
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {WORKLOADS.map((size) => (
              <TableRow
                key={size.id}
                className={size.id === workload ? "selected-workload-row" : ""}
              >
                <TableHead>
                  <span className="workload-table-label">{size.label}</span>
                  <span>{batchLabel(size.batch)} inputs</span>
                </TableHead>
                {GPUS.map((item) => {
                  const result = BENCHMARKS[item.id][size.id];
                  return (
                    <TableCell key={item.id}>
                      <Button
                        variant="ghost"
                        aria-label={`Inspect ${item.name} ${size.label} workload, Variant ${result.variant}`}
                        aria-pressed={gpu === item.id && workload === size.id}
                        className={`registry-result ${gpu === item.id && workload === size.id ? "selected" : ""}`}
                        onClick={() => onSelect(item.id, size.id)}
                      >
                        <span
                          className="registry-variant"
                          style={{ color: VARIANTS[result.variant].color }}
                        >
                          <i>{result.variant}</i>
                          <span>
                            Variant {result.variant}
                            <small>{VARIANTS[result.variant].name}</small>
                          </span>
                        </span>
                        <span className="registry-numbers">
                          {result.latency.toFixed(1)} <small>ms</small>
                          <strong>{speedup(result).toFixed(1)}×</strong>
                        </span>
                        <ArrowUpRight size={12} />
                      </Button>
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="registry-insight">
        <span className="micro">Large workload comparison</span>
        <p>
          At {batchLabel(WORKLOADS[2].batch)} inputs:{" "}
          <strong>3050 → {BENCHMARKS.rtx3050.large.variant}</strong>
          <span> / </span>
          <strong>4060 → {BENCHMARKS.rtx4060.large.variant}</strong>
        </p>
      </div>
    </Card>
  );
}
