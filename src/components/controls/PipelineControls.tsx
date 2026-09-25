"use client";

import * as React from "react";
import { cn } from "cn";
import {
  CrosshairIcon,
  MaximizeIcon,
  MinimizeIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Journey } from "@/data/vtec/journey";
import { SPEED_OPTIONS, type PipelineRun } from "@/hooks/usePipelineRun";

/**
 * The HUD.
 *
 * Floats over the canvas rather than sitting above it, because every pixel this
 * takes from the graph is a pixel of the thing people came to look at.
 */
export default function PipelineControls({
  run,
  journey,
  onReset,
  fullscreen,
  onToggleFullscreen,
  stageLabel,
}: {
  run: PipelineRun;
  journey: Journey;
  onReset: () => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  stageLabel: string;
}) {
  const total = journey.legs.length;
  const running = run.phase === "running";

  return (
    <div className="vtec-hud vtec-hud-controls">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          className="vtec-run-button"
          onClick={running ? run.toggle : run.start}
        >
          {running ? (
            <PauseIcon className="size-3.5" />
          ) : (
            <PlayIcon className="size-3.5" />
          )}
          {running ? "Pause" : "Run proof"}
        </Button>

        <Button variant="outline" size="sm" onClick={onReset}>
          <RotateCcwIcon className="size-3.5" />
          Reset
        </Button>

        <Button
          variant="outline"
          size="sm"
          aria-pressed={run.follow}
          className={cn(run.follow && "vtec-toggle-on")}
          onClick={() => run.setFollow(!run.follow)}
        >
          <CrosshairIcon className="size-3.5" />
          Follow agent
          <span className="vtec-kicker ml-1">{run.follow ? "on" : "off"}</span>
        </Button>

        <div className="vtec-speed" role="group" aria-label="Playback speed">
          {SPEED_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={run.speed === option}
              className={cn(run.speed === option && "is-on")}
              onClick={() => run.setSpeed(option)}
            >
              {option}×
            </button>
          ))}
        </div>

        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          onClick={onToggleFullscreen}
        >
          {fullscreen ? (
            <MinimizeIcon className="size-3.5" />
          ) : (
            <MaximizeIcon className="size-3.5" />
          )}
        </Button>
      </div>

      <Scrubber run={run} total={total} />

      <p className="vtec-kicker truncate" role="status">
        {stageLabel}
      </p>
    </div>
  );
}

/**
 * Uncontrolled on purpose.
 *
 * A controlled range bound to the leg index would step thirty times across a
 * thirteen second run and look like it was ticking. This one is written from
 * the animation frame directly, the same way the agent is, so the thumb glides
 * without putting React on the sixty-a-second path.
 */
function Scrubber({ run, total }: { run: PipelineRun; total: number }) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const readoutRef = React.useRef<HTMLSpanElement>(null);
  const { subscribe } = run;

  React.useEffect(
    () =>
      subscribe((progress) => {
        const clamped = Math.min(total, Math.max(0, progress));
        if (inputRef.current) inputRef.current.value = String(clamped);
        if (readoutRef.current) {
          readoutRef.current.textContent = `${Math.ceil(clamped)}/${total}`;
        }
      }),
    [subscribe, total],
  );

  return (
    <div className="flex items-center gap-3">
      <input
        ref={inputRef}
        type="range"
        min={0}
        max={total}
        step={0.01}
        defaultValue={total}
        aria-label="Replay position"
        onChange={(event) => run.seek(Number(event.target.value))}
        className="vtec-scrub"
      />
      <span
        ref={readoutRef}
        className="vtec-num w-10 shrink-0 text-right text-[11px] text-muted-foreground"
      >
        {total}/{total}
      </span>
    </div>
  );
}
