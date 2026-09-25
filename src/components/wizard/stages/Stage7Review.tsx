"use client";

import * as React from "react";
import { ExternalLinkIcon, LockIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  HashChip,
  SpecRow,
} from "@/components/vtec/primitives";
import { txUrl } from "@/data/vtec";
import { bytes, num } from "@/lib/format";
import { planSentences } from "@/lib/plan";
import { ActionCard, PrimaryAction, RightPanel, StageLayout } from "../shell";
import type { Saga } from "../useSaga";

export default function Stage7Review({ saga }: { saga: Saga }) {
  const { state, advance } = saga;
  const { agent, plan, seal, ens, identity, task } = state;
  const gpu = agent.gpu;
  const sentences = React.useMemo(
    () => (plan ? planSentences(plan) : []),
    [plan],
  );

  const signer =
    identity.path === "passkey"
      ? (identity.passkey?.address ?? null)
      : identity.walletAddress;

  const panel = (
    <RightPanel
      label="Project"
      state="ready"
      tone="success"
      orb={agent.status === "found" ? "found" : "idle"}
      focal={
        <div className="flex w-full flex-col gap-3 text-left">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">{gpu?.name ?? "—"}</span>
            <Badge
              variant="outline"
              className="rounded-md border-[color-mix(in_oklab,var(--success)_45%,transparent)] px-2 py-0 text-[11px] font-normal text-[var(--success)]"
            >
              sealed
            </Badge>
          </div>
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            <span>{task}</span>
            <span className="vtec-num">
              {plan?.batchSizes.map(num).join(" / ")} messages per job
            </span>
            <span>{ens.name ?? "not published"}</span>
          </div>
          {seal.planHash ? (
            <code className="vtec-num rounded-lg border border-border/60 px-2 py-2 text-[11px] leading-relaxed break-all text-muted-foreground">
              {seal.planHash}
            </code>
          ) : null}
        </div>
      }
      helper="Nothing here can change any more. The sweep runs against exactly this."
      pills={[
        gpu ? `${gpu.smCount} SM` : "—",
        plan ? bytes(plan.messageLengthBytes) : "—",
        `median of ${(plan?.runsPerMeasurement ?? 8) - 1}`,
        identity.path === "passkey" ? "passkey" : "external wallet",
      ]}
    />
  );

  return (
    <StageLayout
      headline="Read the sealed project back."
      subhead="Nothing new is decided here. This is everything that was locked, shown once more before any compute is spent."
      panel={panel}
    >
      <ActionCard
        n={1}
        title="The sealed plan"
        why="These sentences are generated from the fields that were hashed. If the hash below matches the one onchain, these are the rules the run is bound by."
        state="complete"
      >
        <ol className="flex flex-col gap-3">
          {sentences.map((sentence, index) => (
            <li key={sentence.id} className="flex gap-3">
              <span className="vtec-num pt-0.5 text-sm text-muted-foreground">
                {index + 1}.
              </span>
              <span className="text-sm leading-relaxed">{sentence.text}</span>
            </li>
          ))}
        </ol>

        <Separator className="bg-border/40" />

        <div className="flex flex-col">
          <SpecRow label="Card">
            {gpu ? `${gpu.name} · ${gpu.smCount} SM · ${gpu.l2CacheMb} MB L2` : "—"}
          </SpecRow>
          <SpecRow label="Hardware fingerprint">
            {gpu ? (
              <HashChip value={gpu.hwFingerprint} lead={10} tail={6} />
            ) : (
              "—"
            )}
          </SpecRow>
          <SpecRow label="Plan hash">
            {seal.planHash ? <HashChip value={seal.planHash} /> : "—"}
          </SpecRow>
          <SpecRow label="Committed by">
            {identity.path === "passkey"
              ? "a passkey on this device"
              : "an existing wallet"}
            {signer ? (
              <span className="vtec-num ml-2 text-xs text-muted-foreground">
                {signer.slice(0, 10)}…
              </span>
            ) : null}
          </SpecRow>
          <SpecRow label="Commit transaction">
            {seal.tx ? (
              <a
                href={txUrl(seal.chain, seal.tx)}
                target="_blank"
                rel="noreferrer"
                className="vtec-num inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                {seal.tx.slice(0, 16)}…
                <ExternalLinkIcon className="size-3" />
              </a>
            ) : (
              "—"
            )}
          </SpecRow>
          <SpecRow label="Publishing name">
            {ens.name ?? "not published — results stay on this machine"}
          </SpecRow>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <LockIcon className="size-3" />
          Sealed{" "}
          {seal.sealedAt
            ? new Date(seal.sealedAt).toLocaleString()
            : "before the run"}
        </div>

        <PrimaryAction onClick={advance}>This is right</PrimaryAction>
      </ActionCard>
    </StageLayout>
  );
}
