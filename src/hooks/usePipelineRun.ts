"use client";

import * as React from "react";
import type { Journey } from "@/data/vtec/journey";
import {
  elapsedAtProgress,
  legAtProgress,
  progressAtElapsed,
} from "@/data/vtec/journey";

/**
 * The clock for a run.
 *
 * Two rates live here on purpose. Progress is continuous and moves every frame,
 * because that is what the agent rides; the leg index is an integer and changes
 * about thirty times in a run, and that is what the twenty node faces and the
 * camera hang off. Keeping them apart is the difference between re-rendering
 * one absolutely positioned div per frame and re-rendering the whole graph.
 *
 * Subscribers get the continuous value. React gets the discrete one.
 */

export type RunPhase = "idle" | "running" | "paused" | "done";

export type PipelineRun = {
  phase: RunPhase;
  /** Integer legs completed, 0..legs.length. Drives node and edge state. */
  legIndex: number;
  /** Continuous position in leg units. Read inside animation frames only. */
  progressRef: React.RefObject<number>;
  follow: boolean;
  speed: number;
  start: () => void;
  toggle: () => void;
  reset: () => void;
  /** Jump to a progress value in leg units and stop. */
  seek: (progress: number) => void;
  setFollow: (value: boolean) => void;
  setSpeed: (value: number) => void;
  /** Called every frame with the continuous progress. Returns an unsubscribe. */
  subscribe: (listener: (progress: number) => void) => () => void;
};

const SPEEDS = [0.5, 1, 2] as const;
export const SPEED_OPTIONS = SPEEDS;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function usePipelineRun(
  journey: Journey,
  { autoPlay = false }: { autoPlay?: boolean } = {},
): PipelineRun {
  const total = journey.legs.length;

  // A run that is not being replayed shows the finished audit trail, which is
  // what this tab has always been when it is not live.
  const [phase, setPhase] = React.useState<RunPhase>(autoPlay ? "idle" : "done");
  const [legIndex, setLegIndex] = React.useState(autoPlay ? 0 : total);
  const [follow, setFollow] = React.useState(true);
  const [speed, setSpeed] = React.useState<number>(1);

  const progressRef = React.useRef(autoPlay ? 0 : total);
  const elapsedRef = React.useRef(autoPlay ? 0 : journey.totalMs);
  const speedRef = React.useRef(speed);
  const rafRef = React.useRef<number | null>(null);
  const lastStampRef = React.useRef<number | null>(null);
  const listenersRef = React.useRef(new Set<(progress: number) => void>());

  speedRef.current = speed;

  const publish = React.useCallback((progress: number) => {
    progressRef.current = progress;
    for (const listener of listenersRef.current) listener(progress);
  }, []);

  const applyProgress = React.useCallback(
    (progress: number) => {
      publish(progress);
      // Ceil, so a node counts as reached only once the agent has arrived.
      setLegIndex(Math.min(total, Math.ceil(progress)));
    },
    [publish, total],
  );

  const stopLoop = React.useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    lastStampRef.current = null;
  }, []);

  // The loop. Wall-clock driven, so a dropped frame costs smoothness and never
  // desynchronises the agent from the node statuses.
  React.useEffect(() => {
    if (phase !== "running") {
      stopLoop();
      return;
    }
    const step = (stamp: number) => {
      const previous = lastStampRef.current;
      lastStampRef.current = stamp;
      // Clamped, because animation frames stop while a tab is backgrounded and
      // the first one after it comes back carries the whole gap. Uncapped, that
      // gap lands as a single jump and the agent teleports to the end of the
      // run — which is precisely what this is supposed to never do.
      const delta = previous === null ? 0 : Math.min(stamp - previous, 100);
      elapsedRef.current += delta * speedRef.current;

      if (elapsedRef.current >= journey.totalMs) {
        elapsedRef.current = journey.totalMs;
        applyProgress(total);
        setPhase("done");
        return;
      }
      applyProgress(progressAtElapsed(journey, elapsedRef.current));
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return stopLoop;
  }, [phase, journey, total, applyProgress, stopLoop]);

  // A new run means a new journey. Live runs start from the top; everything
  // else opens on the finished audit trail, which is what this tab has always
  // been when it is not live.
  React.useEffect(() => {
    if (autoPlay && !prefersReducedMotion()) {
      elapsedRef.current = 0;
      lastStampRef.current = null;
      applyProgress(0);
      setPhase("running");
      return;
    }
    elapsedRef.current = journey.totalMs;
    applyProgress(journey.legs.length);
    setPhase("done");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journey]);

  const start = React.useCallback(() => {
    if (prefersReducedMotion()) {
      elapsedRef.current = journey.totalMs;
      applyProgress(total);
      setPhase("done");
      return;
    }
    elapsedRef.current = 0;
    applyProgress(0);
    lastStampRef.current = null;
    setFollow(true);
    setPhase("running");
  }, [applyProgress, journey.totalMs, total]);

  const toggle = React.useCallback(() => {
    setPhase((current) => {
      if (current === "running") return "paused";
      if (current === "paused") {
        lastStampRef.current = null;
        return "running";
      }
      // idle or done: start over
      elapsedRef.current = 0;
      applyProgress(0);
      lastStampRef.current = null;
      return "running";
    });
  }, [applyProgress]);

  const reset = React.useCallback(() => {
    elapsedRef.current = 0;
    applyProgress(0);
    setPhase("idle");
  }, [applyProgress]);

  const seek = React.useCallback(
    (progress: number) => {
      const clamped = Math.min(total, Math.max(0, progress));
      elapsedRef.current = elapsedAtProgress(journey, clamped);
      applyProgress(clamped);
      setPhase(clamped >= total ? "done" : clamped <= 0 ? "idle" : "paused");
    },
    [applyProgress, journey, total],
  );

  const subscribe = React.useCallback(
    (listener: (progress: number) => void) => {
      listenersRef.current.add(listener);
      listener(progressRef.current);
      return () => {
        listenersRef.current.delete(listener);
      };
    },
    [],
  );

  return {
    phase,
    legIndex,
    progressRef,
    follow,
    speed,
    start,
    toggle,
    reset,
    seek,
    setFollow,
    setSpeed,
    subscribe,
  };
}

/** The leg the run is on right now, for labelling. Recomputed per leg, not per frame. */
export function currentLeg(journey: Journey, legIndex: number) {
  return legAtProgress(journey, legIndex)?.leg ?? null;
}
