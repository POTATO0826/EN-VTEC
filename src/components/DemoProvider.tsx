"use client";
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  GPUS,
  WORKLOADS,
  BENCHMARKS,
  DEMO_TIMING,
  getAttestation,
  type GpuId,
  type WorkloadSize,
} from "../data/mockGpuData";
import type { Crossover } from "./VtecDispatcher";

function useSelectionState() {
  const [selection, setSelection] = useState<{
    gpu: GpuId;
    workload: WorkloadSize;
  }>({ gpu: "rtx3050", workload: "small" });
  const [transition, setTransition] = useState<Crossover | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const transitionId = useRef(0);
  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);
  useEffect(() => clearTimers, [clearTimers]);
  const gpu = GPUS.find((item) => item.id === selection.gpu)!;
  const workload = WORKLOADS.find((item) => item.id === selection.workload)!;
  const result = BENCHMARKS[selection.gpu][selection.workload];
  const attestation = getAttestation(selection.gpu, selection.workload);

  const select = (nextGpu: GpuId, nextWorkload: WorkloadSize) => {
    if (nextGpu === selection.gpu && nextWorkload === selection.workload)
      return;
    clearTimers();
    const next = BENCHMARKS[nextGpu][nextWorkload];
    const hardware = nextGpu !== selection.gpu;
    setSelection({ gpu: nextGpu, workload: nextWorkload });
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTransition(null);
      return;
    }
    if (hardware || next.variant !== result.variant) {
      const id = ++transitionId.current;
      setTransition({
        id,
        from: result.variant,
        to: next.variant,
        hardware,
        stage: hardware ? "scanning" : "switching",
      });
      if (hardware)
        timers.current.push(
          setTimeout(
            () =>
              setTransition((current) =>
                current?.id === id
                  ? { ...current, stage: "switching" }
                  : current,
              ),
            DEMO_TIMING.scan,
          ),
        );
      timers.current.push(
        setTimeout(
          () =>
            setTransition((current) => (current?.id === id ? null : current)),
          DEMO_TIMING.crossover + (hardware ? DEMO_TIMING.scan : 0),
        ),
      );
    } else setTransition(null);
  };

  return { selection, gpu, workload, result, attestation, transition, select };
}
const DemoContext = createContext<ReturnType<typeof useSelectionState> | null>(
  null,
);
export function DemoProvider({ children }: { children: ReactNode }) {
  const value = useSelectionState();
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}
export function useDemo() {
  const value = useContext(DemoContext);
  if (!value) throw new Error("GPU VTEC pages must be inside DemoProvider");
  return value;
}
