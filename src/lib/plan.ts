import type { TestPlan, VariantId } from "@/data/vtec/types";
import { variantName } from "@/data/vtec/variants";
import { bytes, num } from "./format";

/**
 * The plan is the artefact that goes onchain. Two things matter here:
 *
 *  1. The bytes that get hashed are produced by exactly one function, so the
 *     hash the browser recomputes on the proof tab is the hash that was sealed.
 *  2. The plan is readable as English before it is sealed. Nobody should have
 *     to parse JSON to know what they are agreeing to.
 */

/** Stable key order. Changing this changes every hash, so do not reorder casually. */
export function canonicalPlanJson(plan: TestPlan): string {
  const ordered = {
    task: plan.task,
    messageLengthBytes: plan.messageLengthBytes,
    batchSizes: [...plan.batchSizes].sort((a, b) => a - b),
    variantPool: [...plan.variantPool].sort(),
    baselineVariant: plan.baselineVariant,
    runsPerMeasurement: plan.runsPerMeasurement,
    targetMsPerMeasurement: plan.targetMsPerMeasurement,
    oracle: {
      name: plan.oracle.name,
      vectors: plan.oracle.vectors,
      boundaries: [...plan.oracle.boundaries].sort((a, b) => a - b),
    },
    acceptanceRule: plan.acceptanceRule,
  };
  return JSON.stringify(ordered, null, 2);
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * SHA-256 of the canonical plan JSON, as a 0x-prefixed bytes32 string.
 * Runs in the browser with no server round trip - that is the whole point of
 * the verify button on the proof tab.
 */
export async function hashPlan(plan: TestPlan): Promise<string> {
  const data = new TextEncoder().encode(canonicalPlanJson(plan));
  const subtle =
    typeof globalThis.crypto !== "undefined" ? globalThis.crypto.subtle : undefined;
  if (!subtle) return "0x" + "0".repeat(64);
  const digest = await subtle.digest("SHA-256", data);
  return "0x" + toHex(digest);
}

export type PlanSentence = {
  id: string;
  /** The editable field this sentence was generated from. */
  field:
    | "messageLength"
    | "batchSizes"
    | "oracle"
    | "targetMs"
    | "runsPerMeasurement"
    | "acceptanceRule"
    | "variantPool";
  text: string;
};

/**
 * The rules sheet. Generated from the field values, so it cannot drift away
 * from what is actually being sealed.
 */
export function planSentences(plan: TestPlan): PlanSentence[] {
  const sizes = [...plan.batchSizes].sort((a, b) => a - b).map(num).join(" / ");
  const boundaries = plan.oracle.boundaries;
  const boundaryText =
    boundaries.length > 1
      ? `${boundaries.slice(0, -1).join(", ")} and ${boundaries[boundaries.length - 1]}-byte padding boundaries`
      : `${boundaries[0]}-byte padding boundary`;
  const candidates = plan.variantPool.filter((v) => v !== plan.baselineVariant);

  return [
    {
      id: "s1",
      field: "messageLength",
      text: `We will hash ${bytes(plan.messageLengthBytes)} messages using ${plan.task}.`,
    },
    {
      id: "s2",
      field: "batchSizes",
      text: `We will test at ${sizes} messages per job.`,
    },
    {
      id: "s3",
      field: "oracle",
      text: `Every candidate must match ${plan.oracle.name} exactly, on ${num(
        plan.oracle.vectors,
      )} fixed vectors including the ${boundaryText}. Any mismatch is rejected and never timed.`,
    },
    {
      id: "s4",
      field: "targetMs",
      text: `Each timing repeats until the measured region lasts at least ${plan.targetMsPerMeasurement} ms, so the result is a measurement of hashing and not of launch overhead.`,
    },
    {
      id: "s5",
      field: "runsPerMeasurement",
      text: `We will run the baseline, ${variantName(
        plan.baselineVariant,
      )}, ${plan.runsPerMeasurement} times, discard the first, and take the spread of the remaining ${
        plan.runsPerMeasurement - 1
      } as this machine's noise band.`,
    },
    {
      id: "s6",
      field: "acceptanceRule",
      text: `We will accept a candidate only if it is correct AND beats the baseline by more than that noise band. Anything else is rejected as "within noise".`,
    },
    {
      id: "s7",
      field: "variantPool",
      text: `We will report the best of the ${candidates.length} candidates tested under this plan — ${candidates
        .map((v) => variantName(v as VariantId))
        .join(", ")} — not the fastest possible implementation.`,
    },
  ];
}

/** A short, human summary of the acceptance rule, for read-only fields. */
export const ACCEPTANCE_RULE_TEXT =
  "Correct, and faster than the baseline by more than this machine's measured noise band. Everything else is rejected, including candidates that are faster but not by enough to tell apart from run-to-run variation.";
