"use client";

/**
 * What each stage actually requires, as checks that can pass or fail.
 *
 * Before this existed, every stage hand-rolled its own `disabled={!found}` on
 * the Continue button and the rail reported "complete" from a one-line boolean.
 * That produced two problems at once: the user could not see what a stage wanted
 * until they had already done it, and a stage they had walked back past kept
 * claiming it was finished.
 *
 * So requirements are named, ordered, and inspectable:
 *
 *   - the stage page lists them up front, so you know what is needed on arrival
 *   - the gate runs them on Continue and shows each one resolving
 *   - the rail derives its status from the same list, so nothing can say
 *     "complete" while a requirement is unmet
 *
 * A check is a pure function of saga state. Nothing here reaches the network:
 * these verify that a decision has been made and recorded, not that a GPU
 * exists. Checks that need the chain or the machine belong in the evaluator and
 * the consumer, which have the access to do them honestly.
 */

import type { SagaState } from "./useSaga";
import { ACTIONABLE_STAGES } from "./useSaga";

export type Requirement = {
  /** Short label. Shown in the list and while checking. */
  label: string;
  /** What is missing, shown only when it fails. Must say what to do. */
  missing: string;
  /** True when this requirement is satisfied. */
  met: (state: SagaState) => boolean;
  /** Evidence when met, e.g. the value that was chosen. Shown in the list. */
  evidence?: (state: SagaState) => string | null;
};

/** One line at the top of each stage: what this page is for, in the imperative. */
export const STAGE_ASK: Record<number, { verb: string; ask: string; kind: StageKind }> = {
  1: { verb: "Detect", ask: "Find the card this project will be measured on.", kind: "act" },
  2: { verb: "Choose", ask: "Pick the task every candidate has to compute correctly.", kind: "choose" },
  3: { verb: "Review", ask: "Read the rules that decide what counts as a win.", kind: "read" },
  4: { verb: "Sign in", ask: "Create or connect the key that will sign the plan.", kind: "act" },
  5: { verb: "Commit", ask: "Put the plan hash onchain, permanently, before any test runs.", kind: "commit" },
  6: { verb: "Claim", ask: "Optionally claim a name so the result is readable outside this app.", kind: "choose" },
  7: { verb: "Confirm", ask: "Read the sealed plan back before the sweep starts.", kind: "read" },
  8: { verb: "Run", ask: "Start the sweep on your own card.", kind: "act" },
  9: { verb: "Watch", ask: "The run is live. This is where you watch it.", kind: "read" },
};

/** Drives the accent and icon, so stages that need action look different from
 *  stages that only need reading. */
export type StageKind = "act" | "choose" | "read" | "commit";

/* -------------------------------------------------------------------------- */

const REQUIREMENTS: Record<number, Requirement[]> = {
  1: [
    {
      label: "A GPU has been detected",
      missing: "Run the scan. Nothing is read from your machine until you press it.",
      met: (s) => s.agent.status === "found" && !!s.agent.gpu,
      evidence: (s) => s.agent.gpu?.name ?? null,
    },
    {
      label: "Its hardware fingerprint was derived",
      missing: "The scan did not produce a fingerprint. Run it again.",
      met: (s) => !!s.agent.gpu?.hwFingerprint,
      evidence: (s) =>
        s.agent.gpu ? `${s.agent.gpu.hwFingerprint.slice(0, 10)}…` : null,
    },
  ],

  2: [
    {
      label: "A task has been chosen",
      missing: "Pick a task. It decides which correctness oracle every candidate must match.",
      met: (s) => !!s.task,
      evidence: (s) => s.task,
    },
    {
      label: "The task has a correctness oracle",
      missing: "This task has no oracle pinned yet, so nothing could be checked against it.",
      met: (s) => s.task === "sha256",
      evidence: (s) => (s.task === "sha256" ? "Python's hashlib" : null),
    },
  ],

  3: [
    {
      label: "A test plan exists",
      missing: "The plan has not been built yet.",
      met: (s) => !!s.plan,
    },
    {
      label: "Job sizes are set",
      missing: "The plan needs at least one job size to measure at.",
      met: (s) => (s.plan?.batchSizes.length ?? 0) > 0,
      evidence: (s) =>
        s.plan ? `${s.plan.batchSizes.length} sizes` : null,
    },
    {
      label: "A baseline is named",
      missing: "Without a baseline there is nothing for candidates to be measured against.",
      met: (s) => !!s.plan?.baselineVariant,
      evidence: (s) =>
        s.plan ? `variant ${s.plan.baselineVariant}` : null,
    },
    {
      label: "Candidates are in the pool",
      missing: "The plan has no candidates to try.",
      met: (s) => (s.plan?.variantPool.length ?? 0) > 1,
      evidence: (s) =>
        s.plan ? `${s.plan.variantPool.length - 1} against the baseline` : null,
    },
  ],

  4: [
    {
      label: "An identity path was chosen",
      missing: "Choose a passkey or connect an existing wallet.",
      met: (s) => !!s.identity.path,
      evidence: (s) => s.identity.path,
    },
    {
      label: "A signing key is available",
      missing:
        "The chosen path has not produced a key yet. A passkey needs creating; a wallet needs connecting.",
      met: (s) =>
        (s.identity.path === "passkey" && !!s.identity.passkey) ||
        (s.identity.path === "wallet" && !!s.identity.walletAddress),
      evidence: (s) =>
        s.identity.path === "wallet" && s.identity.walletAddress
          ? `${s.identity.walletAddress.slice(0, 8)}…`
          : s.identity.passkey
            ? "passkey on this device"
            : null,
    },
    {
      label: "No identity error outstanding",
      missing: "The last attempt failed. Resolve it before continuing.",
      met: (s) => !s.identity.error,
    },
  ],

  5: [
    {
      label: "The plan hash was computed",
      missing: "There is no hash to commit yet.",
      met: (s) => !!s.seal.planHash,
      evidence: (s) => (s.seal.planHash ? `${s.seal.planHash.slice(0, 12)}…` : null),
    },
    {
      label: "The commit transaction confirmed",
      missing:
        "The plan is not sealed yet. Press Seal and wait for the transaction to confirm.",
      met: (s) => s.seal.status === "sealed" && !!s.seal.tx,
      evidence: (s) => (s.seal.tx ? `${s.seal.tx.slice(0, 12)}…` : null),
    },
  ],

  6: [
    {
      label: "A publishing decision was made",
      missing: "Claim a name, or skip. Skipping is a valid answer and keeps the result local.",
      met: (s) => s.ens.status === "claimed" || s.ens.status === "skipped",
      evidence: (s) =>
        s.ens.status === "claimed" ? s.ens.name : s.ens.status === "skipped" ? "skipped" : null,
    },
  ],

  7: [
    {
      label: "The sealed plan was read back",
      missing: "Scroll through the sealed plan above before starting the sweep.",
      // Reaching this stage at all means the earlier gates passed; the honest
      // requirement here is the seal still standing, not a pretend checkbox.
      met: (s) => s.seal.status === "sealed",
      evidence: (s) => (s.seal.tx ? "sealed onchain" : null),
    },
  ],

  8: [
    {
      label: "The sweep has started",
      missing: "Press Start. The sweep runs on your own card against the sealed plan.",
      met: (s) => s.run.status === "live",
      evidence: (s) => (s.run.resultId ? s.run.resultId : null),
    },
  ],

  9: [],
};

export function requirementsFor(stage: number): Requirement[] {
  return REQUIREMENTS[stage] ?? [];
}

export type RequirementResult = {
  requirement: Requirement;
  met: boolean;
  evidence: string | null;
};

export function checkStage(state: SagaState, stage: number): RequirementResult[] {
  return requirementsFor(stage).map((requirement) => ({
    requirement,
    met: requirement.met(state),
    evidence: requirement.met(state) ? (requirement.evidence?.(state) ?? null) : null,
  }));
}

/**
 * A stage is complete when every one of its requirements is met.
 *
 * This is the only definition. The rail, the gate and the Continue button all
 * read it, so they cannot disagree about whether something is finished.
 */
export function stageSatisfied(state: SagaState, stage: number): boolean {
  const results = checkStage(state, stage);
  return results.length > 0 && results.every((result) => result.met);
}

/** How many requirements are outstanding, for the rail's live counter. */
export function outstandingCount(state: SagaState, stage: number): number {
  return checkStage(state, stage).filter((result) => !result.met).length;
}

/* -------------------------------------------------------------------------- */
/* Rail status                                                                 */
/* -------------------------------------------------------------------------- */

export type RailStatus =
  | "done" // finished, and behind you
  | "done-ahead" // finished earlier, but you have walked back past it
  | "current-ready" // you are here, and everything is satisfied
  | "current-open" // you are here, and something is still needed
  | "next" // the immediate next step
  | "locked" // not reachable yet
  | "destination"; // stage 9, which is arrived at rather than done

/**
 * The rail's status for one stage.
 *
 * The bug this replaces: `stageComplete` answered "was this ever done" and the
 * rail rendered it as "is this behind me". Walking back to stage 5 left stages
 * 6 to 9 showing COMPLETE below it, with nothing saying where you actually were.
 * Position and history are now separate, and both are visible.
 */
export function railStatus(state: SagaState, stage: number): RailStatus {
  const satisfied = stageSatisfied(state, stage);

  if (stage === state.stage) {
    return satisfied ? "current-ready" : "current-open";
  }
  if (stage === 9) {
    return state.run.status === "live" ? "done" : "destination";
  }
  if (stage < state.stage) {
    return satisfied ? "done" : "locked";
  }
  // Ahead of the cursor.
  if (satisfied) return "done-ahead";
  return stage === state.stage + 1 ? "next" : "locked";
}

export const RAIL_LABEL: Record<RailStatus, string> = {
  done: "done",
  "done-ahead": "done · ahead",
  "current-ready": "ready to continue",
  "current-open": "needs you",
  next: "up next",
  locked: "not started",
  destination: "destination",
};

/** "Stage 5 of 8 · 3 done" for the rail header. */
export function progressSummary(state: SagaState): {
  stage: number;
  total: number;
  done: number;
} {
  let done = 0;
  for (let stage = 1; stage <= ACTIONABLE_STAGES; stage += 1) {
    if (stageSatisfied(state, stage)) done += 1;
  }
  return { stage: Math.min(state.stage, ACTIONABLE_STAGES), total: ACTIONABLE_STAGES, done };
}
