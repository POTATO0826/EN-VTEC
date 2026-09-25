"use client";

import * as React from "react";
import type { GPU, TaskId, TestPlan } from "@/data/vtec/types";
import type { IdentityPath, PasskeyAccount, PasskeyStatus } from "@/lib/identity";

/**
 * Saga state.
 *
 * The user is meant to be able to close the tab and come back, so everything
 * that has been decided is written to localStorage under a run id and restored
 * on mount. Nothing here is sent anywhere.
 */

export const STAGES = [
  { id: 1, title: "Agent & GPU", rail: "Agent & GPU" },
  { id: 2, title: "Task", rail: "Task" },
  { id: 3, title: "Test plan", rail: "Test plan" },
  { id: 4, title: "Identity", rail: "Identity" },
  { id: 5, title: "Seal the rules", rail: "Seal the rules" },
  { id: 6, title: "Publishing name", rail: "Publishing name" },
  { id: 7, title: "Review", rail: "Review" },
  { id: 8, title: "Run", rail: "Run" },
  { id: 9, title: "Live", rail: "Live" },
] as const;

/** Stage 9 is where the saga ends up, not a step the user takes. */
export const ACTIONABLE_STAGES = 8;

/** What the current stage commits the user to. Shown under the rail, always. */
export const STAGE_COMMITMENTS: Record<number, string> = {
  1: "Nothing yet. Detection only reads the card and derives a fingerprint; it changes nothing on your machine and writes nothing onchain.",
  2: "Nothing yet. Picking a task decides which correctness oracle every candidate has to match before it is allowed to be timed.",
  3: "Nothing yet, but read it. These rules decide what counts as a win, and after the sealing stage nobody can change them.",
  4: "A key you will keep. A passkey creates an embedded wallet on this device; connecting an existing wallet uses the one you already have. Either way it signs the plan.",
  5: "This one is permanent. The plan hash goes onchain before any test runs, and neither you nor we can change the rules afterwards.",
  6: "Publishing only. Claiming a name makes the result readable outside this app. Skip it and the result stays on your machine.",
  7: "Nothing new. This is the sealed plan read back to you before the sweep starts.",
  8: "Compute time on your own card. The sweep runs locally; results are written against the plan hash that was already sealed.",
  9: "Nothing. The run is live and this is where you watch it.",
};

export type SealStatus = "idle" | "confirming" | "pending" | "sealed" | "failed";
export type EnsStatus = "idle" | "claiming" | "claimed" | "skipped";
export type RunStatus = "idle" | "starting" | "live";

export type SagaState = {
  runId: string;
  stage: number;
  reached: number;
  agent: {
    status: "idle" | "scanning" | "found" | "absent";
    gpu: GPU | null;
    detectedAt: string | null;
  };
  task: TaskId | null;
  plan: TestPlan | null;
  identity: {
    path: IdentityPath | null;
    passkeyStatus: PasskeyStatus;
    passkey: PasskeyAccount | null;
    walletAddress: string | null;
    error: string | null;
  };
  seal: {
    status: SealStatus;
    tx: string | null;
    planHash: string | null;
    chain: string;
    sealedAt: string | null;
  };
  ens: {
    status: EnsStatus;
    name: string | null;
    contributor: string | null;
  };
  run: { status: RunStatus; resultId: string | null };
};

const ACTIVE_KEY = "gpuvtec.saga.active";
const stateKey = (runId: string) => `gpuvtec.saga.${runId}`;

export function newRunId(): string {
  return `draft-${Date.now().toString(36)}`;
}

export function initialState(runId: string): SagaState {
  return {
    runId,
    stage: 1,
    reached: 1,
    agent: { status: "idle", gpu: null, detectedAt: null },
    task: null,
    plan: null,
    identity: {
      path: null,
      passkeyStatus: "idle",
      passkey: null,
      walletAddress: null,
      error: null,
    },
    seal: {
      status: "idle",
      tx: null,
      planHash: null,
      chain: "Base",
      sealedAt: null,
    },
    ens: { status: "idle", name: null, contributor: null },
    run: { status: "idle", resultId: null },
  };
}

function load(): SagaState | null {
  if (typeof window === "undefined") return null;
  try {
    const runId = window.localStorage.getItem(ACTIVE_KEY);
    if (!runId) return null;
    const raw = window.localStorage.getItem(stateKey(runId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SagaState;
    if (!parsed || typeof parsed.stage !== "number") return null;
    return { ...initialState(runId), ...parsed, runId };
  } catch {
    return null;
  }
}

function persist(state: SagaState) {
  try {
    window.localStorage.setItem(ACTIVE_KEY, state.runId);
    window.localStorage.setItem(stateKey(state.runId), JSON.stringify(state));
  } catch {
    /* refusing to store is not a reason to block the wizard */
  }
}

export function clearSaga(runId: string) {
  try {
    window.localStorage.removeItem(stateKey(runId));
    window.localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* nothing to do */
  }
}

export type Saga = {
  state: SagaState;
  /** True until the stored state has been read, so nothing flashes stage 1. */
  loading: boolean;
  set: (updater: (state: SagaState) => SagaState) => void;
  goTo: (stage: number) => void;
  advance: () => void;
  reset: () => void;
};

export function useSaga(): Saga {
  const [state, setState] = React.useState<SagaState>(() =>
    initialState("draft-pending"),
  );
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    const restored = load();
    setState(restored ?? initialState(newRunId()));
    setLoading(false);
  }, []);

  React.useEffect(() => {
    if (loading) return;
    persist(state);
  }, [state, loading]);

  const set = React.useCallback(
    (updater: (current: SagaState) => SagaState) => {
      setState((current) => {
        const next = updater(current);
        return { ...next, reached: Math.max(next.reached, next.stage) };
      });
    },
    [],
  );

  const goTo = React.useCallback((stage: number) => {
    setState((current) => {
      // Forward-only past a sealed stage: you can look back, never edit back.
      const limit = Math.max(current.reached, 1);
      const target = Math.min(Math.max(stage, 1), Math.min(limit, 9));
      return { ...current, stage: target };
    });
  }, []);

  const advance = React.useCallback(() => {
    setState((current) => {
      const stage = Math.min(current.stage + 1, 9);
      return { ...current, stage, reached: Math.max(current.reached, stage) };
    });
  }, []);

  const reset = React.useCallback(() => {
    setState((current) => {
      clearSaga(current.runId);
      return initialState(newRunId());
    });
  }, []);

  return { state, loading, set, goTo, advance, reset };
}

/** A stage is complete when the thing it exists to decide has been decided. */
export function stageComplete(state: SagaState, stage: number): boolean {
  switch (stage) {
    case 1:
      return state.agent.status === "found" && !!state.agent.gpu;
    case 2:
      return !!state.task;
    case 3:
      return !!state.plan;
    case 4:
      return (
        (state.identity.path === "passkey" && !!state.identity.passkey) ||
        (state.identity.path === "wallet" && !!state.identity.walletAddress)
      );
    case 5:
      return state.seal.status === "sealed";
    case 6:
      return state.ens.status === "claimed" || state.ens.status === "skipped";
    case 7:
      return state.reached > 7;
    case 8:
      return state.run.status === "live";
    case 9:
      return state.run.status === "live";
    default:
      return false;
  }
}
