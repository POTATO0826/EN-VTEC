import type { TaskId, VariantId } from "./types";

/**
 * A variant is never referred to by its letter alone anywhere in the UI.
 * Everything goes through `variantName` so that rule cannot quietly rot.
 */
export const VARIANTS: Record<
  VariantId,
  { id: VariantId; label: string; detail: string }
> = {
  A: {
    id: "A",
    label: "scalar reference",
    detail:
      "One thread per message, textbook round schedule. This is the baseline everything else is measured against.",
  },
  B: {
    id: "B",
    label: "shared-memory schedule",
    detail:
      "Stages the message schedule in shared memory so each round re-reads on-chip instead of going back to L2.",
  },
  C: {
    id: "C",
    label: "warp-parallel schedule",
    detail:
      "Spreads one message across a warp and exchanges schedule words with shuffles, trading occupancy for fewer memory round-trips.",
  },
  D: {
    id: "D",
    label: "full unroll",
    detail:
      "All 64 rounds unrolled with constants folded in. More instructions per message, but no loop bookkeeping and no schedule re-reads.",
  },
  E: {
    id: "E",
    label: "persistent blocks",
    detail:
      "Launches one block per SM and loops over messages inside the kernel, so the launch cost is paid once instead of per batch.",
  },
};

export const VARIANT_ORDER: VariantId[] = ["A", "B", "C", "D", "E"];

/** "variant D - full unroll" */
export function variantName(id: VariantId): string {
  return `variant ${id} — ${VARIANTS[id].label}`;
}

/** "D - full unroll", for tight columns where "variant" is already the header. */
export function variantShort(id: VariantId): string {
  return `${id} — ${VARIANTS[id].label}`;
}

export const TASKS: Record<
  TaskId,
  {
    id: TaskId;
    name: string;
    available: boolean;
    oracle: string;
    description: string;
  }
> = {
  sha256: {
    id: "sha256",
    name: "sha256",
    available: true,
    oracle: "Python's hashlib",
    description:
      "Hashes a batch of fixed-length messages. The output is byte-exact or it is wrong, which is what makes it safe to benchmark honestly.",
  },
  keccak256: {
    id: "keccak256",
    name: "keccak256",
    available: false,
    oracle: "pysha3",
    description:
      "Not available yet. The correctness oracle and padding vectors still have to be pinned down before anything can be timed against it.",
  },
};
