"use client";

import * as React from "react";
import { grade, SPOKE_SETS, spokeStats, type ResultEntry, type SpokeStat } from "@/lib/results";

/*
 * The hexagon: one spoke per harness measurement, scored 0 at the baseline
 * kernel and 100 at the leaderboard's best. Radius 40 is the baseline ring,
 * 170 the best.
 */
const C = 220;
const rOf = (score: number) => 40 + (Math.max(-25, Math.min(100, score)) / 100) * 130;
const pt = (k: number, r: number) => {
  const a = ((-90 + 60 * k) * Math.PI) / 180;
  return [C + r * Math.cos(a), C + r * Math.sin(a)] as const;
};
const ring = (r: number) => [0, 1, 2, 3, 4, 5].map((k) => pt(k, r).map((v) => v.toFixed(1)).join(",")).join(" ");
const poly = (scores: number[]) => scores.map((s, k) => pt(k, rOf(s)).map((v) => v.toFixed(1)).join(",")).join(" ");

// Spoke labels, clockwise from the top: [x, y, text-anchor].
const LABELS: [number, number, "middle" | "start" | "end"][] = [
  [220, 20, "middle"],
  [393, 122, "start"],
  [393, 322, "start"],
  [220, 422, "middle"],
  [47, 322, "end"],
  [47, 122, "end"],
];

type Shape = { med: number[]; lo: number[]; hi: number[]; ghost: number[] };

/** Eases the chart from one entry's shape to the next. */
function useTweenedShape(target: Shape) {
  const [shape, setShape] = React.useState(target);
  const current = React.useRef(target);
  const key = JSON.stringify(target);
  React.useEffect(() => {
    const from = current.current;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      current.current = target;
      setShape(target);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const k = Math.min(1, (now - start) / 400);
      const e = 1 - Math.pow(1 - k, 3);
      const mix = (a: number[], b: number[]) => b.map((v, i) => (a[i] ?? v) + (v - (a[i] ?? v)) * e);
      const next = { med: mix(from.med, target.med), lo: mix(from.lo, target.lo), hi: mix(from.hi, target.hi), ghost: mix(from.ghost, target.ghost) };
      current.current = next;
      setShape(next);
      if (k < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // The key stands in for the target's contents.
  }, [key]);
  return shape;
}

export default function SkillChart({ entry, sample }: { entry: ResultEntry; sample: boolean }) {
  const { cats: CATS } = SPOKE_SETS[entry.set];
  const stats = spokeStats(entry);
  const shape = useTweenedShape({
    med: stats.map((s) => s.med),
    lo: stats.map((s) => s.lo),
    hi: stats.map((s) => s.hi),
    ghost: stats.map((s) => s.ghost),
  });

  // Hover state belongs to one entry; switching entries clears it.
  const [spoke, setSpoke] = React.useState<number | null>(null);
  const [hoverCat, setHoverCat] = React.useState<string | null>(null);
  const [forId, setForId] = React.useState(entry.id);
  if (forId !== entry.id) {
    setForId(entry.id);
    setSpoke(null);
    setHoverCat(null);
  }

  const d = entry.detail;
  const running = d.status === "pending" || d.status === "verifying";
  const noRuns = entry.runs.length === 0;
  const measured = stats.filter((s) => s.measured);
  const cat = hoverCat ?? (spoke != null ? stats[spoke].cat : null);
  const dim = (c: string) => (cat && cat !== c ? 0.4 : 1);

  let readout: string;
  let readoutBad = false;
  if (noRuns) {
    readout = running
      ? "Pending verification: the chart fills in as verifier runs land. 0 ring = baseline kernel, 100 ring = best verified on this track."
      : "No valid runs: no verifier reproduced the baseline's output, so there is nothing to chart.";
  } else if (spoke == null) {
    readout = `Hover a vertex for the real value. 0 ring = the baseline kernel on ${entry.hardware}; 100 ring = the best verified kernel on ${entry.model}.`;
    if (entry.set === "harness") readout += " PRECISION: 0 = at the track's tolerance, 100 = identical output.";
    if (measured.length < stats.length) readout += ` ${stats.length - measured.length} spoke(s) need a report from the current agent.`;
  } else {
    const s = stats[spoke];
    if (!s.measured || !s.r) readout = `${s.name}: not in this report. Reports from the current agent record it.`;
    else {
      readoutBad = s.med < 0;
      readout = `${s.name}: ${s.medianText} · ${s.deltaText} · range ${s.rangeText} · ${s.baselineText}${s.hv ? " · high variance" : ""}`;
    }
  }

  const cards = Object.keys(CATS).map((key) => categoryCard(key, stats, noRuns));
  const scored = cards.filter((c) => c.score != null);
  const power = noRuns || !scored.length ? null : Math.round(scored.reduce((a, c) => a + Math.max(0, Math.min(100, c.score!)), 0) / scored.length);
  const band = noRuns ? "" : `M${poly(shape.hi).split(" ").join(" L")} Z M${poly(shape.lo).split(" ").join(" L")} Z`;

  return (
    <>
      <div className="border-t border-border pt-2">
        <div className="flex items-baseline justify-between gap-3">
          <h6 className="m-0 font-display text-[11px] font-extrabold tracking-[0.1em] uppercase">
            Kernel stats · vs baseline on {entry.hardware}
          </h6>
          {sample ? (
            <span className="text-[11px] whitespace-nowrap text-muted-foreground">Sample data</span>
          ) : running ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] whitespace-nowrap text-muted-foreground">
              <span className="online-dot animate-pulse motion-reduce:animate-none" /> Live
            </span>
          ) : null}
        </div>

        <svg viewBox="-70 -10 580 450" className="mx-auto mt-1 block w-full max-w-[560px] overflow-visible">
          {[25, 50, 75].map((s) => (
            <polygon key={s} points={ring(rOf(s))} fill="none" stroke="rgba(237,238,240,0.12)" strokeWidth={1} />
          ))}
          {[0, 1, 2, 3, 4, 5].map((k) => {
            const [x, y] = pt(k, 170);
            return <line key={k} x1={C} y1={C} x2={x} y2={y} stroke="rgba(237,238,240,0.16)" strokeWidth={1} />;
          })}
          <polygon points={ring(40)} fill="none" stroke="rgba(237,238,240,0.6)" strokeWidth={1.5} />
          <polygon points={ring(170)} fill="none" stroke="rgba(237,238,240,0.75)" strokeWidth={1.5} />
          <text x={228} y={176} className="fill-muted-foreground font-mono text-[9px]">0 · baseline</text>
          <text x={228} y={46} className="fill-muted-foreground font-mono text-[9px]">100 · best</text>

          <polygon points={poly(shape.ghost)} fill="none" stroke="rgba(237,238,240,0.35)" strokeWidth={1} strokeDasharray="4 4" />
          <path d={band} fill="rgba(207,230,255,0.16)" fillRule="evenodd" />
          <polygon
            points={poly(noRuns ? shape.med.map(() => 0) : shape.med)}
            fill="rgba(207,230,255,0.08)"
            stroke="#cfe6ff"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeDasharray={noRuns || running ? "6 5" : "none"}
            style={{ filter: "drop-shadow(0 0 6px rgba(207,230,255,0.55))" }}
          />

          {noRuns
            ? null
            : stats.map((s, k) => (
                <Vertex
                  key={s.key}
                  stat={s}
                  at={pt(k, rOf(s.measured ? shape.med[k] : 0))}
                  active={spoke === k || cat === s.cat}
                  onEnter={() => setSpoke(k)}
                  onLeave={() => setSpoke(null)}
                />
              ))}

          {stats.map((s, k) => {
            const [x, y, anchor] = LABELS[k];
            return (
              <text
                key={s.key}
                x={x}
                y={y}
                textAnchor={anchor}
                fill={CATS[s.cat].color}
                opacity={dim(s.cat) * (s.measured ? 1 : 0.4)}
                className="font-display text-[11px] font-extrabold tracking-[0.1em]"
              >
                {s.label}
              </text>
            );
          })}
          {noRuns ? (
            <text x={C} y={224} textAnchor="middle" fill={running ? "#d8b072" : "#dc7777"} className="font-display text-[10px] font-extrabold tracking-[0.12em]">
              {running ? "PENDING" : "NO VALID RUNS"}
            </text>
          ) : null}
        </svg>

        <div
          className={`mt-1 min-h-[38px] border-t border-border/60 pt-2 font-mono text-xs text-pretty ${readoutBad ? "text-[var(--danger)]" : spoke != null ? "text-foreground" : "text-muted-foreground"}`}
        >
          {readout}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-3.5 text-[11px] text-muted-foreground">
          <Legend swatch={<span className="h-0.5 w-3.5 bg-kv-ice" />}>median</Legend>
          <Legend swatch={<span className="h-2 w-3.5 bg-kv-ice/18" />}>verified range</Legend>
          <Legend swatch={<span className="w-3.5 border-t border-dashed border-foreground/50" />}>rank #1</Legend>
          <Legend swatch={<span className="size-2 rounded-full bg-[var(--danger)]" />}>below baseline</Legend>
          <Legend swatch={<span className="font-extrabold text-[var(--warning)]">!</span>}>high variance</Legend>
          {measured.length < stats.length ? (
            <Legend swatch={<span className="size-2 rounded-full border border-muted-foreground" />}>not in report</Legend>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-2">
        {cards.map((c) => (
          <div
            key={c.key}
            onMouseEnter={() => setHoverCat(c.key)}
            onMouseLeave={() => setHoverCat(null)}
            className={`flex flex-col gap-1.5 rounded-lg border border-border/60 px-3 pt-3 pb-3.5 transition-colors ${cat === c.key ? "bg-accent/60" : "bg-card/60"}`}
          >
            <div className="flex items-baseline justify-between">
              <span className="text-[10px] font-extrabold tracking-[0.1em]" style={{ color: CATS[c.key].color }}>
                {CATS[c.key].label}
              </span>
              <span
                className={`font-display text-lg leading-none font-extrabold ${c.grade === "S" ? "text-foreground" : c.grade === "C" ? "text-muted-foreground" : "text-foreground/80"}`}
              >
                {c.grade}
              </span>
            </div>
            <div className={`font-mono text-[22px] leading-none font-semibold ${c.score != null && c.score < 0 ? "text-[var(--danger)]" : "text-foreground"}`}>
              {c.value}
            </div>
            <div className="font-mono text-[10px] text-muted-foreground">{c.sub}</div>
            <div className="relative mt-1 h-1.5 rounded-full bg-border/40">
              {c.score != null ? (
                <div
                  className="absolute inset-y-0 rounded-full"
                  style={{
                    left: `${c.score < 0 ? c.fill : 20}%`,
                    width: `${Math.abs(c.fill - 20)}%`,
                    background: c.score < 0 ? "#dc7777" : CATS[c.key].color,
                  }}
                />
              ) : null}
              <div className="absolute -inset-y-[3px] left-[20%] w-0.5 bg-foreground" />
              <div className="absolute -inset-y-[3px] right-0 w-0.5 bg-foreground/60" />
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-end gap-4 border-t border-border pt-3">
        <div>
          <h6 className="m-0 mb-0.5 font-display text-[11px] font-extrabold tracking-[0.1em] text-muted-foreground uppercase">Power level</h6>
          <div className="font-display text-[44px] leading-none font-extrabold tracking-[-0.02em] tabular-nums">{power ?? "—"}</div>
        </div>
        <div className="pb-1.5">
          <div className="mb-1.5 text-[11px] text-muted-foreground">
            {scored.length === 4 || !scored.length
              ? "Mean of the four category scores"
              : `Mean of the measured category scores (${scored.length} of 4)`}{" "}
            · 0 = baseline, 100 = leaderboard best
          </div>
          <div className="relative h-2 rounded-full bg-border/40">
            <div className="absolute inset-y-0 left-0 rounded-full bg-kv-ice" style={{ width: `${power ?? 0}%` }} />
          </div>
        </div>
      </div>
    </>
  );
}

function categoryCard(key: string, stats: SpokeStat[], noRuns: boolean) {
  const measured = stats.filter((s) => s.cat === key && s.measured);
  if (!measured.length) return { key, grade: "–", value: "—", sub: "not in report", score: null, fill: 20 };
  const head = measured[0];
  if (noRuns || !head.r) return { key, grade: "–", value: "—", sub: "awaiting runs", score: null, fill: 20 };
  const score = measured.reduce((a, s) => a + s.med, 0) / measured.length;
  return {
    key,
    grade: grade(score),
    // Times read as their gain over the baseline; precision as the error itself.
    value: head.scale === "tolerance" ? head.medianText : head.deltaText.replace(" vs baseline", ""),
    sub: `${head.rangeText} · ${head.name}`,
    score,
    fill: ((Math.max(-25, Math.min(100, score)) + 25) / 125) * 100,
  };
}

function Vertex({
  stat,
  at,
  active,
  onEnter,
  onLeave,
}: {
  stat: SpokeStat;
  at: readonly [number, number];
  active: boolean;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const [cx, cy] = at;
  const below = stat.med < 0;
  const aria = stat.measured && stat.r ? `${stat.name}: ${stat.medianText}, ${stat.deltaText}` : `${stat.name}: not in report`;
  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={stat.measured ? (active ? 7 : 5) : 3.5}
        tabIndex={0}
        role="button"
        aria-label={aria}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        onFocus={onEnter}
        onBlur={onLeave}
        fill={!stat.measured || stat.hv ? "#101012" : below ? "#dc7777" : "#ededee"}
        stroke={!stat.measured ? "#a1a1aa" : below ? "#dc7777" : stat.hv ? "#d8b072" : "#cfe6ff"}
        strokeWidth={stat.measured ? 2 : 1.5}
        className="cursor-pointer outline-none"
      />
      {stat.hv ? (
        <text x={cx} y={cy} dx={9} dy={-7} className="pointer-events-none fill-[var(--warning)] text-[10px] font-extrabold">
          !
        </text>
      ) : null}
    </g>
  );
}

function Legend({ swatch, children }: { swatch: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {swatch}
      {children}
    </span>
  );
}
