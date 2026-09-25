import { ArrowRight, Check, ScanLine } from "lucide-react";
import WorkloadSelector from "./WorkloadSelector";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "./ui/card";
import { Badge } from "./ui/badge";
import {
  VARIANTS,
  DEMO_INFO,
  speedup,
  type Benchmark,
  type Gpu,
  type WorkloadSize,
  type VariantId,
} from "../data/mockGpuData";

export interface Crossover {
  id: number;
  from: VariantId;
  to: VariantId;
  hardware: boolean;
  stage: "scanning" | "switching";
}
export function CrossoverAnimation({ transition }: { transition: Crossover }) {
  return (
    <div key={transition.id} className="crossover-animation" role="status">
      {transition.stage === "scanning" ? (
        <>
          <ScanLine size={17} />
          <span>
            Different hardware detected
            <small>Re-evaluating optimal variant</small>
          </span>
        </>
      ) : (
        <>
          <span className="crossover-label">
            {transition.from === transition.to
              ? "STRATEGY RETAINED"
              : "VTEC CROSSOVER"}
          </span>
          <strong>{transition.from}</strong>
          <ArrowRight size={20} />
          <strong>{transition.to}</strong>
        </>
      )}
      <div className="crossover-sweep" />
    </div>
  );
}
export default function VtecDispatcher({
  gpu,
  workload,
  result,
  transition,
  onWorkload,
}: {
  gpu: Gpu;
  workload: WorkloadSize;
  result: Benchmark;
  transition: Crossover | null;
  onWorkload: (size: WorkloadSize) => void;
}) {
  const variant = VARIANTS[result.variant];
  return (
    <Card
      className="dispatcher"
      id="dispatcher"
      aria-labelledby="dispatcher-title"
    >
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle id="dispatcher-title">VTEC Dispatcher</CardTitle>
          <Badge variant="outline">
            <span className="online-dot" /> Adaptive
          </Badge>
        </div>
        <CardDescription>
          The best kernel for your hardware and workload.
        </CardDescription>
      </CardHeader>
      <CardContent className="dispatcher-content">
        <div className="workload-controls">
          <div>
            <strong>{DEMO_INFO.kernel}</strong>
            <span>Batch size</span>
          </div>
          <WorkloadSelector selected={workload} onSelect={onWorkload} />
        </div>
        <div className="dispatch-readout" aria-live="polite" aria-atomic="true">
          <div className="selected-variant">
            <span className="metric-label">Selected kernel</span>
            <div key={result.variant} className="variant-title">
              Variant <strong>{result.variant}</strong>
            </div>
            <span className="cam-name">
              <i style={{ background: variant.color }} />
              {variant.name.toLowerCase()}
            </span>
          </div>
          <div className="dispatch-metrics">
            <div>
              <span className="metric-label">Latency</span>
              <strong>
                {result.latency.toFixed(1)}
                <small>ms</small>
              </strong>
            </div>
            <div>
              <span className="metric-label">Speedup</span>
              <strong>
                {speedup(result).toFixed(1)}
                <small>×</small>
              </strong>
              <span className="metric-hint">vs. baseline</span>
            </div>
          </div>
        </div>
        <div
          className="variant-track"
          aria-label={`Active kernel variant ${result.variant}`}
        >
          {(Object.keys(VARIANTS) as VariantId[]).map((id) => (
            <div
              key={id}
              className={`variant-stage ${id === result.variant ? "active" : ""}`}
            >
              <span>Variant {id}</span>
              <small>{VARIANTS[id].name.toLowerCase()}</small>
              {id === result.variant && <Check size={14} />}
            </div>
          ))}
        </div>
        <div className="decision-reason">
          <strong>Why this kernel</strong>
          <p>{result.reason}</p>
        </div>
      </CardContent>
      <CardFooter className="dispatcher-footer">
        <span>
          <Check size={14} /> Correctness verified
        </span>
        <span>
          {DEMO_INFO.samples} samples · {gpu.name}
        </span>
      </CardFooter>
      {transition && <CrossoverAnimation transition={transition} />}
    </Card>
  );
}
