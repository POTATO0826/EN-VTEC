"use client";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Card } from "./ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { useState } from "react";
import Link from "next/link";
import { useDemo } from "./DemoProvider";
import WorkloadSelector from "./WorkloadSelector";
import { Activity, ArrowRight, Cpu, Terminal, RotateCcw } from "lucide-react";
import GpuFleet from "./GpuFleet";
import VtecDispatcher from "./VtecDispatcher";
import WorkloadFeed from "./WorkloadFeed";
import PerformanceChart from "./PerformanceChart";
import OptimizationPipeline from "./OptimizationPipeline";
import RegistryTable from "./RegistryTable";
import AttestationPanel, { AttestationModal } from "./AttestationPanel";
import {
  GPUS,
  DEMO_INFO,
  VARIANTS,
  batchLabel,
  type Attestation,
  type GpuId,
} from "../data/mockGpuData";

export type DashboardPage = "overview" | "performance" | "registry";
const pageInfo = {
  overview: {
    title: "Overview",
    description: "Manage your GPUs and see which kernel fits the job.",
  },
  performance: {
    title: "Performance",
    description:
      "Compare benchmark results and review the optimization history.",
  },
  registry: {
    title: "Registry",
    description:
      "Verified kernel configurations, organized by hardware and workload.",
  },
};
export default function Dashboard({
  page = "overview",
}: {
  page?: DashboardPage;
}) {
  const { selection, gpu, workload, result, attestation, transition, select } =
    useDemo();
  const [selectedAttestation, setSelectedAttestation] =
    useState<Attestation | null>(null);
  const info = pageInfo[page];

  return (
    <>
      <main className={`dashboard dashboard-${page}`} id={`${page}-page`}>
        <div className="dashboard-heading">
          <div>
            <h1>{info.title}</h1>
            <p>{info.description}</p>
          </div>
          <div className="session-info">
            <Badge variant="outline">Demo workspace</Badge>
          </div>
        </div>
        <div className="system-ribbon">
          <span>
            <span className="online-dot" /> System online
          </span>
          <span>
            <Cpu size={13} /> {gpu.fullName}
          </span>
          <span>
            <Activity size={13} /> {DEMO_INFO.kernel} /{" "}
            {batchLabel(workload.batch)} inputs
          </span>
          <span className="ribbon-note">Simulated data</span>
        </div>
        {page !== "overview" && (
          <div className="page-context-controls">
            <div className="gpu-context-select">
              <span className="micro">Hardware</span>
              <Select
                value={selection.gpu}
                onValueChange={(value) =>
                  select(value as GpuId, selection.workload)
                }
              >
                <SelectTrigger aria-label="Active GPU">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GPUS.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="context-workload">
              <span className="micro">Workload</span>
              <WorkloadSelector
                selected={selection.workload}
                onSelect={(size) => select(selection.gpu, size)}
              />
            </div>
          </div>
        )}
        {page === "overview" && (
          <>
            <div className="dashboard-top-grid">
              <GpuFleet
                selected={selection.gpu}
                onSelect={(id) => select(id, selection.workload)}
              />
              <VtecDispatcher
                gpu={gpu}
                workload={selection.workload}
                result={result}
                transition={transition}
                onWorkload={(size) => select(selection.gpu, size)}
              />
            </div>
            <WorkloadFeed />
            <div className="page-next-links">
              <Button asChild variant="ghost">
                <Link href="/performance">
                  View performance <ArrowRight size={15} />
                </Link>
              </Button>
              <Button asChild variant="ghost">
                <Link href="/registry">
                  View registry <ArrowRight size={15} />
                </Link>
              </Button>
            </div>
          </>
        )}
        {page === "performance" && (
          <>
            <div className="performance-grid">
              <PerformanceChart
                gpu={selection.gpu}
                workload={selection.workload}
              />
              <Card className="decision-panel">
                <div className="panel-heading">
                  <h2>
                    <Terminal size={15} /> Selection details
                  </h2>
                  <span className="micro"></span>
                </div>
                <p className="panel-caption">
                  The context behind the selected kernel.
                </p>
                <ol className="trace-steps">
                  <li>
                    <span>01</span>
                    <div>
                      <small>Hardware</small>
                      <strong>{gpu.name}</strong>
                      <p>
                        {gpu.architecture} · {gpu.sm} SM · {gpu.vram} GB
                      </p>
                    </div>
                  </li>
                  <li>
                    <span>02</span>
                    <div>
                      <small>Workload</small>
                      <strong>{batchLabel(workload.batch)} inputs</strong>
                      <p>
                        {DEMO_INFO.kernel} · {workload.label.toLowerCase()}{" "}
                        batch
                      </p>
                    </div>
                  </li>
                  <li>
                    <span>03</span>
                    <div>
                      <small>Selected kernel</small>
                      <strong style={{ color: VARIANTS[result.variant].color }}>
                        Variant {result.variant} /{" "}
                        {VARIANTS[result.variant].name}
                      </strong>
                      <p>Fastest valid configuration</p>
                    </div>
                  </li>
                </ol>
                <div className="trace-conclusion">
                  <ArrowRight size={16} />
                  <p>
                    Selected from verified history.
                    <span>No optimization runs in your browser.</span>
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-button demo-reset"
                  onClick={() => select("rtx3050", "small")}
                >
                  <RotateCcw size={12} /> Reset hardware & workload
                </Button>
              </Card>
            </div>
            <OptimizationPipeline
              gpu={selection.gpu}
              workload={selection.workload}
            />
          </>
        )}
        {page === "registry" && (
          <>
            <div className="registry-grid">
              <RegistryTable
                gpu={selection.gpu}
                workload={selection.workload}
                onSelect={select}
              />
              <AttestationPanel
                attestation={attestation}
                onView={() => setSelectedAttestation(attestation)}
              />
            </div>
          </>
        )}
        <footer className="dashboard-footer">
          <span>
            <span className="online-dot" /> GPU VTEC <span>/</span> Adaptive
            kernel intelligence
          </span>
          <span>
            Mock data <span>·</span> No GPU execution
          </span>
        </footer>
      </main>
      {selectedAttestation && (
        <AttestationModal
          attestation={selectedAttestation}
          onClose={() => setSelectedAttestation(null)}
        />
      )}
    </>
  );
}
