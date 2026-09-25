"use client";

import * as React from "react";
import { cn } from "cn";
import { LockIcon, PlusIcon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { SectionLabel } from "@/components/vtec/primitives";
import type { TestPlan, VariantId } from "@/data/vtec/types";
import { VARIANTS, VARIANT_ORDER, variantName } from "@/data/vtec/variants";
import { proposalsFor } from "@/lib/agent";
import { bytes, num } from "@/lib/format";
import {
  ACCEPTANCE_RULE_TEXT,
  hashPlan,
  planSentences,
  type PlanSentence,
} from "@/lib/plan";
import { ActionCard, PrimaryAction, RightPanel, StageLayout } from "../shell";
import type { Saga } from "../useSaga";

const MESSAGE_LENGTHS = [64, 1024, 4096, 16384];
const SUGGESTED_SIZES = [16384, 65536, 262144, 1048576, 2097152, 4194304];
const RUN_COUNTS = [4, 8, 12, 16];
const TARGET_MS = [10, 15, 20, 25, 30];

function defaultPlan(): TestPlan {
  return {
    task: "sha256",
    messageLengthBytes: 4096,
    batchSizes: [65536, 262144, 1048576, 2097152],
    variantPool: ["A", "B", "C", "D", "E"],
    baselineVariant: "A",
    runsPerMeasurement: 8,
    targetMsPerMeasurement: 20,
    oracle: {
      name: "Python's hashlib",
      vectors: 1000,
      boundaries: [55, 56, 64],
    },
    acceptanceRule: "beats-baseline-by-more-than-noise-band",
  };
}

/** Recomputes as the sentences change. The hash is the artefact, not the JSON. */
function useLivePlanHash(plan: TestPlan | null) {
  const [hash, setHash] = React.useState<string | null>(null);
  const [recomputing, setRecomputing] = React.useState(false);

  React.useEffect(() => {
    if (!plan) return;
    let cancelled = false;
    setRecomputing(true);
    const timer = window.setTimeout(() => {
      hashPlan(plan).then((value) => {
        if (cancelled) return;
        setHash(value);
        setRecomputing(false);
      });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [plan]);

  return { hash, recomputing };
}

export default function Stage3Plan({ saga }: { saga: Saga }) {
  const { state, set, advance } = saga;
  const gpu = state.agent.gpu;
  const plan = state.plan ?? defaultPlan();
  const [highlight, setHighlight] = React.useState<PlanSentence["field"] | null>(
    null,
  );
  const [customSize, setCustomSize] = React.useState("");
  const fieldRefs = React.useRef<
    Partial<Record<PlanSentence["field"], HTMLDivElement | null>>
  >({});

  const { hash, recomputing } = useLivePlanHash(plan);
  const sentences = React.useMemo(() => planSentences(plan), [plan]);
  const proposals = React.useMemo(
    () => (gpu ? proposalsFor(gpu) : []),
    [gpu],
  );

  React.useEffect(() => {
    if (!state.plan) {
      set((current) => ({ ...current, plan: defaultPlan() }));
    }
  }, [state.plan, set]);

  const update = React.useCallback(
    (patch: Partial<TestPlan>) => {
      set((current) => ({
        ...current,
        plan: { ...(current.plan ?? defaultPlan()), ...patch },
      }));
    },
    [set],
  );

  const jumpToField = (field: PlanSentence["field"]) => {
    setHighlight(field);
    fieldRefs.current[field]?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    window.setTimeout(() => setHighlight(null), 1800);
  };

  const fieldClass = (field: PlanSentence["field"]) =>
    cn(
      "flex flex-col gap-2 rounded-lg px-3 py-3 transition-colors -mx-3",
      highlight === field && "bg-accent/50 ring-1 ring-primary/40",
    );

  const toggleVariant = (variant: VariantId) => {
    if (variant === plan.baselineVariant) return;
    const next = plan.variantPool.includes(variant)
      ? plan.variantPool.filter((item) => item !== variant)
      : [...plan.variantPool, variant];
    update({ variantPool: VARIANT_ORDER.filter((id) => next.includes(id)) });
  };

  const removeSize = (size: number) => {
    if (plan.batchSizes.length <= 1) return;
    update({ batchSizes: plan.batchSizes.filter((item) => item !== size) });
  };

  const addSize = (size: number) => {
    if (!Number.isFinite(size) || size <= 0) return;
    if (plan.batchSizes.includes(size)) return;
    update({ batchSizes: [...plan.batchSizes, size].sort((a, b) => a - b) });
  };

  const panel = (
    <RightPanel
      label="Test plan"
      state={recomputing ? "recomputing" : "draft"}
      tone={recomputing ? "info" : "warning"}
      orb={state.agent.status === "found" ? "found" : "idle"}
      focal={
        <div className="flex w-full flex-col items-center gap-3">
          <SectionLabel>Live plan hash</SectionLabel>
          <code
            className={cn(
              "vtec-num w-full rounded-lg border border-border/60 px-3 py-3 text-xs leading-relaxed break-all transition-opacity",
              recomputing && "opacity-40",
            )}
          >
            {hash ?? "computing…"}
          </code>
        </div>
      }
      helper="This hash goes onchain before any test runs."
      pills={[
        bytes(plan.messageLengthBytes),
        `${plan.batchSizes.length} job sizes`,
        `median of ${plan.runsPerMeasurement - 1}`,
        `${plan.targetMsPerMeasurement} ms target`,
      ]}
    />
  );

  return (
    <StageLayout
      headline="Agree the rules before anything is measured."
      subhead="These rules decide what counts as a win. Read them now, because after the sealing stage nobody can change them — including us."
      panel={panel}
    >
      <ActionCard
        n={1}
        title="What the agent proposes"
        why="The agent read your card and proposed these values, each with the reason it proposed them. It proposes and explains. It does not confirm, it does not commit, and it does not decide what counts as fast or correct."
        state="complete"
      >
        <div className="flex flex-col gap-0">
          {proposals.map((proposal) => (
            <div
              key={proposal.field}
              className="grid gap-2 border-b border-border/40 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] md:gap-6"
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-sm">{proposal.label}</span>
                <span className="vtec-num text-sm text-foreground/80">
                  {proposal.value}
                </span>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {proposal.reason}
              </p>
            </div>
          ))}
        </div>
      </ActionCard>

      <ActionCard
        n={2}
        title="Edit the rules"
        why="Everything the agent proposed is pre-filled and every one of it is yours to change. Nothing is locked until you seal it."
        state="active"
      >
        <div className="flex flex-col gap-1">
          <div
            ref={(node) => {
              fieldRefs.current.messageLength = node;
            }}
            className={fieldClass("messageLength")}
          >
            <label className="text-sm">Message length</label>
            <Select
              value={String(plan.messageLengthBytes)}
              onValueChange={(value) =>
                update({ messageLengthBytes: Number(value) })
              }
            >
              <SelectTrigger className="w-full max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MESSAGE_LENGTHS.map((length) => (
                  <SelectItem key={length} value={String(length)}>
                    {bytes(length)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div
            ref={(node) => {
              fieldRefs.current.batchSizes = node;
            }}
            className={fieldClass("batchSizes")}
          >
            <label className="text-sm">Job sizes, in messages per job</label>
            <div className="flex flex-wrap gap-2">
              {plan.batchSizes.map((size) => (
                <span
                  key={size}
                  className="inline-flex items-center gap-2 rounded-md border border-border/60 py-1.5 pr-1.5 pl-3 text-xs"
                >
                  <span className="vtec-num">{num(size)}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${num(size)} messages`}
                    onClick={() => removeSize(size)}
                    className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                  >
                    <XIcon className="size-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {SUGGESTED_SIZES.filter(
                (size) => !plan.batchSizes.includes(size),
              ).map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => addSize(size)}
                  className="vtec-num inline-flex items-center gap-1 rounded-md border border-dashed border-border/60 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  <PlusIcon className="size-3" />
                  {num(size)}
                </button>
              ))}
              <span className="inline-flex items-center gap-1 rounded-md border border-border/60 py-1 pr-1 pl-2">
                <input
                  value={customSize}
                  inputMode="numeric"
                  placeholder="custom"
                  onChange={(event) =>
                    setCustomSize(event.target.value.replace(/[^0-9]/g, ""))
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addSize(Number(customSize));
                      setCustomSize("");
                    }
                  }}
                  className="vtec-num w-20 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                />
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    addSize(Number(customSize));
                    setCustomSize("");
                  }}
                >
                  Add
                </Button>
              </span>
            </div>
          </div>

          <div
            ref={(node) => {
              fieldRefs.current.variantPool = node;
            }}
            className={fieldClass("variantPool")}
          >
            <label className="text-sm">Variant pool</label>
            <div className="flex flex-col gap-2">
              {VARIANT_ORDER.map((variant) => {
                const selected = plan.variantPool.includes(variant);
                const isBaseline = variant === plan.baselineVariant;
                return (
                  <button
                    key={variant}
                    type="button"
                    onClick={() => toggleVariant(variant)}
                    disabled={isBaseline}
                    className={cn(
                      "flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                      selected
                        ? "border-border bg-accent/30"
                        : "border-border/60 opacity-60",
                      isBaseline && "cursor-not-allowed",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border",
                        selected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border/60",
                      )}
                    >
                      {selected ? (
                        <span className="text-[9px] leading-none">✓</span>
                      ) : null}
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-sm">
                        {variantName(variant)}
                        {isBaseline ? (
                          <Badge
                            variant="outline"
                            className="ml-2 rounded-md border-border/60 px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
                          >
                            baseline
                          </Badge>
                        ) : null}
                      </span>
                      <span className="text-xs leading-relaxed text-muted-foreground">
                        {VARIANTS[variant].detail}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-1 md:grid-cols-2">
            <div
              ref={(node) => {
                fieldRefs.current.runsPerMeasurement = node;
              }}
              className={fieldClass("runsPerMeasurement")}
            >
              <label className="text-sm">Runs per measurement</label>
              <Select
                value={String(plan.runsPerMeasurement)}
                onValueChange={(value) =>
                  update({ runsPerMeasurement: Number(value) })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RUN_COUNTS.map((count) => (
                    <SelectItem key={count} value={String(count)}>
                      {count} — keep {count - 1}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div
              ref={(node) => {
                fieldRefs.current.targetMs = node;
              }}
              className={fieldClass("targetMs")}
            >
              <label className="text-sm">Target per measurement</label>
              <Select
                value={String(plan.targetMsPerMeasurement)}
                onValueChange={(value) =>
                  update({ targetMsPerMeasurement: Number(value) })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TARGET_MS.map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      {value} ms
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div
            ref={(node) => {
              fieldRefs.current.acceptanceRule = node;
            }}
            className={fieldClass("acceptanceRule")}
          >
            <div className="flex items-center gap-2">
              <label className="text-sm">Acceptance rule</label>
              <LockIcon className="size-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">read-only</span>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {ACCEPTANCE_RULE_TEXT}
            </p>
          </div>

          <div
            ref={(node) => {
              fieldRefs.current.oracle = node;
            }}
            className={fieldClass("oracle")}
          >
            <div className="flex items-center gap-2">
              <label className="text-sm">Correctness oracle</label>
              <LockIcon className="size-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                set with the task
              </span>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {plan.oracle.name}, {num(plan.oracle.vectors)} fixed vectors,
              including the {plan.oracle.boundaries.join(", ")}-byte padding
              boundaries.
            </p>
          </div>
        </div>
      </ActionCard>

      <ActionCard
        n={3}
        title="Read what will be sealed"
        why="This is the artefact that goes onchain, written out in full. If a sentence here is not what you meant, change the field it came from — every sentence links back to it."
        state="active"
      >
        <ol className="flex flex-col gap-3">
          {sentences.map((sentence, index) => (
            <li key={sentence.id} className="flex gap-3">
              <span className="vtec-num pt-0.5 text-sm text-muted-foreground">
                {index + 1}.
              </span>
              <span className="text-sm leading-relaxed">
                {sentence.text}{" "}
                <button
                  type="button"
                  onClick={() => jumpToField(sentence.field)}
                  className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  edit
                </button>
              </span>
            </li>
          ))}
        </ol>

        <Separator className="bg-border/40" />

        <div className="flex flex-col gap-2">
          <SectionLabel>Plan hash</SectionLabel>
          <code
            className={cn(
              "vtec-num text-xs break-all transition-opacity",
              recomputing && "opacity-40",
            )}
          >
            {hash ?? "computing…"}
          </code>
          <p className="text-xs text-muted-foreground">
            This hash goes onchain before any test runs.
          </p>
        </div>

        <PrimaryAction onClick={advance} disabled={!hash}>
          These are the rules
        </PrimaryAction>
      </ActionCard>
    </StageLayout>
  );
}
