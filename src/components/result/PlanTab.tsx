"use client";

import * as React from "react";
import { cn } from "cn";
import {
  CheckCircle2Icon,
  ExternalLinkIcon,
  ShieldCheckIcon,
  XCircleIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  HashChip,
  Panel,
  SectionLabel,
  SpecRow,
} from "@/components/vtec/primitives";
import { txUrl, ensUrl } from "@/data/vtec";
import type { Run, TestPlan } from "@/data/vtec/types";
import { canonicalPlanJson, hashPlan, planSentences } from "@/lib/plan";
import { shortDate } from "@/lib/format";

type VerifyState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "pass"; computed: string }
  | { status: "fail"; computed: string };

export default function PlanTab({ run }: { run: Run }) {
  const [tampered, setTampered] = React.useState(false);
  const [verify, setVerify] = React.useState<VerifyState>({ status: "idle" });

  // Tampering changes one field. The hash then cannot match, which is the point:
  // the check has to be able to fail, or it is not a check.
  const plan: TestPlan = React.useMemo(
    () =>
      tampered
        ? { ...run.plan, targetMsPerMeasurement: run.plan.targetMsPerMeasurement + 5 }
        : run.plan,
    [run.plan, tampered],
  );

  const json = React.useMemo(() => canonicalPlanJson(plan), [plan]);

  React.useEffect(() => {
    setVerify({ status: "idle" });
  }, [tampered]);

  const runVerification = React.useCallback(async () => {
    setVerify({ status: "running" });
    const computed = await hashPlan(plan);
    setVerify(
      computed === run.planHash
        ? { status: "pass", computed }
        : { status: "fail", computed },
    );
  }, [plan, run.planHash]);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 xl:grid-cols-3">
        <Panel className="gap-5 xl:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionLabel>Committed plan</SectionLabel>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                simulate a tampered plan
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={tampered}
                onClick={() => setTampered((value) => !value)}
                className={cn(
                  "relative h-5 w-9 rounded-full border border-border/60 transition-colors",
                  tampered ? "bg-[var(--danger)]/70" : "bg-muted",
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 size-3.5 rounded-full bg-foreground transition-all",
                    tampered ? "left-[18px]" : "left-0.5",
                  )}
                />
              </button>
            </div>
          </div>

          <pre className="vtec-num overflow-x-auto rounded-lg border border-border/60 bg-muted/20 p-4 text-xs leading-relaxed">
            {json}
          </pre>

          <p className="text-xs leading-relaxed text-muted-foreground">
            These are the exact bytes that were hashed. Key order is fixed, so
            the same plan always produces the same hash — that is what makes the
            check below meaningful rather than ceremonial.
          </p>
        </Panel>

        <div className="flex flex-col gap-6">
          <Panel className="gap-5 p-6">
            <SectionLabel>Verify in your browser</SectionLabel>
            <p className="text-sm leading-relaxed text-muted-foreground">
              This re-hashes the plan on the left with your browser&apos;s own
              SHA-256 and compares it to the value that was committed. Nothing
              is sent anywhere, and nothing we say is taken on trust.
            </p>

            <Button
              className="h-11 w-fit rounded-full px-6"
              onClick={runVerification}
              disabled={verify.status === "running"}
            >
              <ShieldCheckIcon className="size-4" />
              {verify.status === "running"
                ? "Hashing…"
                : "Verify in your browser"}
            </Button>

            {verify.status === "pass" || verify.status === "fail" ? (
              <div
                className={cn(
                  "flex flex-col gap-3 rounded-lg border p-4",
                  verify.status === "pass"
                    ? "border-[color-mix(in_oklab,var(--success)_45%,transparent)] bg-[color-mix(in_oklab,var(--success)_8%,transparent)]"
                    : "border-[color-mix(in_oklab,var(--danger)_45%,transparent)] bg-[color-mix(in_oklab,var(--danger)_8%,transparent)]",
                )}
              >
                <span
                  className={cn(
                    "flex items-center gap-2 text-sm",
                    verify.status === "pass"
                      ? "text-[var(--success)]"
                      : "text-[var(--danger)]",
                  )}
                >
                  {verify.status === "pass" ? (
                    <CheckCircle2Icon className="size-4" />
                  ) : (
                    <XCircleIcon className="size-4" />
                  )}
                  {verify.status === "pass"
                    ? "Match. This plan is the one that was committed."
                    : "No match. This plan is not the one that was committed."}
                </span>
                <div className="flex flex-col gap-2 text-xs">
                  <div className="flex flex-col gap-1">
                    <span className="text-muted-foreground">computed here</span>
                    <code className="vtec-num break-all">{verify.computed}</code>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-muted-foreground">
                      committed onchain
                    </span>
                    <code className="vtec-num break-all">{run.planHash}</code>
                  </div>
                </div>
                {verify.status === "fail" ? (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    One field was changed. That is all it takes — which is why
                    the hash goes onchain before the run rather than after it.
                  </p>
                ) : null}
              </div>
            ) : null}
          </Panel>

          <Panel className="gap-4 p-6">
            <SectionLabel>Onchain record</SectionLabel>
            <div className="flex flex-col">
              <SpecRow label="Chain">{run.chain}</SpecRow>
              <SpecRow label="Plan hash">
                <HashChip value={run.planHash} lead={12} tail={8} />
              </SpecRow>
              <SpecRow label="Committed">
                <a
                  href={txUrl(run.chain, run.commitTx)}
                  target="_blank"
                  rel="noreferrer"
                  className="vtec-num inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  {run.commitTx.slice(0, 14)}…
                  <ExternalLinkIcon className="size-3" />
                </a>
              </SpecRow>
              <SpecRow label="Revealed">
                <a
                  href={txUrl(run.chain, run.revealTx)}
                  target="_blank"
                  rel="noreferrer"
                  className="vtec-num inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  {run.revealTx.slice(0, 14)}…
                  <ExternalLinkIcon className="size-3" />
                </a>
              </SpecRow>
              <SpecRow label="Committed by">
                {run.committedBy === "passkey"
                  ? "a passkey on the operator's device"
                  : "an existing wallet"}
              </SpecRow>
              <SpecRow label="Run date">{shortDate(run.createdAt)}</SpecRow>
              {run.ensName ? (
                <SpecRow label="Published as">
                  <a
                    href={ensUrl(run.ensName)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {run.ensName}
                    <ExternalLinkIcon className="size-3" />
                  </a>
                </SpecRow>
              ) : null}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              The commit came first and the reveal came after. Anyone can check
              that ordering without asking us.
            </p>
          </Panel>
        </div>
      </div>

      <Panel className="gap-4">
        <div className="flex items-center gap-3">
          <SectionLabel>The same plan, in English</SectionLabel>
          <Badge
            variant="outline"
            className="rounded-md border-border/60 px-2 py-0 text-[11px] font-normal text-muted-foreground"
          >
            generated from the JSON above
          </Badge>
        </div>
        <Separator className="bg-border/40" />
        <ol className="flex flex-col gap-3">
          {planSentences(plan).map((sentence, index) => (
            <li key={sentence.id} className="flex gap-3">
              <span className="vtec-num pt-0.5 text-sm text-muted-foreground">
                {index + 1}.
              </span>
              <span className="text-sm leading-relaxed text-muted-foreground">
                {sentence.text}
              </span>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}
