"use client";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "./ui/accordion";
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from "./ui/table";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { useEffect, useState } from "react";
import {
  GitBranch,
  Check,
  X,
  RotateCcw,
  ArrowRight,
  Circle,
} from "lucide-react";
import {
  CANDIDATES,
  PIPELINE_STEPS,
  DEMO_TIMING,
  type Candidate,
  type GpuId,
  type WorkloadSize,
} from "../data/mockGpuData";

export function CandidateResult({
  candidate,
  index,
}: {
  candidate: Candidate;
  index: number;
}) {
  return (
    <TableRow
      className="candidate-row"
      style={{ animationDelay: `${index * 90}ms` }}
    >
      <TableCell>
        <strong>{candidate.id}</strong>
        <span>{candidate.change}</span>
      </TableCell>
      <TableCell className="micro">
        <Check size={12} /> COMPILED
      </TableCell>
      <TableCell
        className={candidate.correct ? "correct-result" : "incorrect-result"}
      >
        {candidate.correct ? <Check size={13} /> : <X size={13} />}
        {candidate.correct ? "Correct" : "Incorrect"}
      </TableCell>
      <TableCell className="mono">
        {candidate.speedup ? `${candidate.speedup.toFixed(2)}×` : "EXCLUDED"}
      </TableCell>
      <TableCell>
        <Badge
          variant="outline"
          className={`verdict ${candidate.verdict.toLowerCase()}`}
        >
          {candidate.verdict.toLowerCase()}
        </Badge>
      </TableCell>
      <TableCell>{candidate.reason}</TableCell>
    </TableRow>
  );
}

export default function OptimizationPipeline({
  gpu,
  workload,
}: {
  gpu: GpuId;
  workload: WorkloadSize;
}) {
  const [expanded, setExpanded] = useState(false);
  const [step, setStep] = useState(-1);
  const [replay, setReplay] = useState(0);
  const candidates = CANDIDATES[gpu][workload];
  useEffect(() => {
    if (!expanded) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStep(PIPELINE_STEPS.length);
      return;
    }
    setStep(0);
    let current = 0;
    const timer = setInterval(() => {
      current++;
      setStep(current);
      if (current >= PIPELINE_STEPS.length) clearInterval(timer);
    }, DEMO_TIMING.pipelineStep);
    return () => clearInterval(timer);
  }, [expanded, replay, gpu, workload]);
  return (
    <Accordion
      type="single"
      collapsible
      value={expanded ? "history" : ""}
      onValueChange={(value) => setExpanded(value === "history")}
    >
      <AccordionItem value="history" className="discovery-panel" id="discovery">
        <AccordionTrigger className="discovery-toggle">
          <span className="discovery-icon">
            <GitBranch size={20} />
          </span>
          <span>
            <strong>Optimization history</strong>
            <small>
              Review candidates, validation checks, and accepted improvements.
            </small>
          </span>
          <span className="discovery-summary micro">
            {candidates.length} candidates <span>·</span>{" "}
            {
              candidates.filter((candidate) => candidate.verdict === "ACCEPTED")
                .length
            }{" "}
            accepted
          </span>
        </AccordionTrigger>
        {expanded && (
          <AccordionContent className="discovery-content">
            <div className="flex items-center justify-between gap-3 mb-5">
              <span className="micro">
                Discovery replay · simulated history
              </span>
              <Button
                variant="outline"
                size="sm"
                className="text-button"
                onClick={() => setReplay((value) => value + 1)}
              >
                <RotateCcw size={12} /> Replay
              </Button>
            </div>
            <ol className="pipeline-steps">
              {PIPELINE_STEPS.map((label, index) => (
                <li
                  className={
                    index < step ? "complete" : index === step ? "current" : ""
                  }
                  key={label}
                >
                  <span className="step-icon">
                    {index < step ? <Check size={13} /> : <Circle size={12} />}
                  </span>
                  <span>{label}</span>
                  {index < PIPELINE_STEPS.length - 1 && (
                    <ArrowRight size={12} className="step-arrow" />
                  )}
                </li>
              ))}
            </ol>
            <p className="pipeline-status" role="status">
              {step < PIPELINE_STEPS.length
                ? `Replaying: ${PIPELINE_STEPS[Math.max(0, step)]}…`
                : "Replay complete. Incorrect outputs and noise-band results never enter the registry."}
            </p>
            <div className="table-scroll">
              <Table className="candidate-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Candidate</TableHead>
                    <TableHead>Compile</TableHead>
                    <TableHead>Correctness</TableHead>
                    <TableHead>Speedup</TableHead>
                    <TableHead>Decision</TableHead>
                    <TableHead>Why</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {CANDIDATES[gpu][workload].map((candidate, index) => (
                    <CandidateResult
                      key={`${gpu}-${workload}-${replay}-${candidate.id}`}
                      candidate={candidate}
                      index={index}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="discovery-note">
              <Check size={14} />
              <p>
                Only correct, repeatable improvements enter the registry.
                <span>
                  These candidates and pipeline stages are prerecorded demo
                  data.
                </span>
              </p>
            </div>
          </AccordionContent>
        )}
      </AccordionItem>
    </Accordion>
  );
}
