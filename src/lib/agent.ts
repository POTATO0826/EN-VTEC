import type { GPU } from "@/data/vtec/types";
import { GPUS } from "@/data/vtec/runs";

/**
 * Adapter for the local agent - the piece that runs on the machine with the GPU.
 *
 * There is no agent in this build, so detection is simulated. The states and
 * the shape of the reply are the real ones, so swapping in a real transport
 * (a localhost socket, say) is a change to this file and nothing else.
 */

export type AgentState = "idle" | "scanning" | "found" | "absent";

export const AGENT_INSTALL_COMMAND =
  "curl -fsSL https://gpuvtec.dev/agent | sh";

export type DetectOptions = {
  /** Set from ?agent=none to exercise the no-agent state. */
  absent?: boolean;
  signal?: AbortSignal;
};

export type DetectResult =
  | { ok: true; gpu: GPU; detectedAt: string }
  | { ok: false; reason: string };

/** The card the demo agent reports. Deliberately the one the copy talks about. */
export const DEMO_GPU: GPU = GPUS[0];

export function detectGpu({
  absent = false,
  signal,
}: DetectOptions = {}): Promise<DetectResult> {
  return new Promise((resolve) => {
    const timer = setTimeout(
      () => {
        if (absent) {
          resolve({
            ok: false,
            reason:
              "No local agent answered on this machine. Creating a project needs the agent running on the machine that has the GPU.",
          });
          return;
        }
        resolve({
          ok: true,
          gpu: { ...DEMO_GPU, status: "online" },
          detectedAt: new Date().toISOString(),
        });
      },
      absent ? 900 : 2200,
    );
    signal?.addEventListener("abort", () => clearTimeout(timer));
  });
}

/**
 * Values the agent proposes after reading the card, each with the reason it
 * proposes them. The agent proposes and explains. It never confirms, never
 * commits, and never decides what counts as fast or correct.
 */
export type Proposal = {
  field: string;
  label: string;
  value: string;
  reason: string;
};

export function proposalsFor(gpu: GPU): Proposal[] {
  return [
    {
      field: "messageLength",
      label: "Message length",
      value: "4 KB",
      reason: `${gpu.l2CacheMb} MB L2 — 4 KB messages will exercise the cache; 64-byte messages will not.`,
    },
    {
      field: "batchSizes",
      label: "Job sizes",
      value: "65,536 / 262,144 / 1,048,576 / 2,097,152",
      reason: `${gpu.smCount} SMs — anything under about 65,536 messages measures launch overhead rather than hashing, so it is left out.`,
    },
    {
      field: "variantPool",
      label: "Variant pool",
      value: "A, B, C, D, E",
      reason:
        "All five compile for compute capability " +
        gpu.computeCapability +
        ". Nothing is excluded before it has been measured.",
    },
    {
      field: "runsPerMeasurement",
      label: "Runs per measurement",
      value: "8, first discarded",
      reason:
        "Seven kept runs give a median that is not one lucky sample, and a spread wide enough to call a noise band from.",
    },
    {
      field: "targetMs",
      label: "Target per measurement",
      value: "20 ms",
      reason:
        "Each timing repeats until the measured region lasts 20 ms, so the result is not noise.",
    },
    {
      field: "oracle",
      label: "Correctness oracle",
      value: "Python's hashlib, 1,000 vectors",
      reason:
        "Includes the 55, 56 and 64-byte padding boundaries, which is where a wrong kernel is wrong.",
    },
  ];
}
