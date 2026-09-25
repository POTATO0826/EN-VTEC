import { msAt } from "@/data/vtec";
import type { Run, VariantId } from "@/data/vtec/types";

/**
 * The median for one variant at the run's headline job size.
 *
 * The baseline has no `Candidate` row — a candidate is something measured
 * *against* the baseline, so the reference implementation is not one of them —
 * but it is very much timed, and its number lives in the curves. Reading the
 * curve covers both, and returns null only when a variant genuinely was never
 * timed, which is what a failed correctness gate produces.
 */
export function medianFor(
  run: Run,
  variant: VariantId | undefined,
): number | null {
  if (!variant) return null;
  const index = run.plan.batchSizes.indexOf(run.headlineJobSize);
  if (index < 0) return null;
  return msAt(run, variant, index);
}
