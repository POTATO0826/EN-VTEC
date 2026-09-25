"use client";

import * as React from "react";
import { cn } from "cn";
import {
  ExternalLinkIcon,
  LockIcon,
  LockOpenIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  HashChip,
  SectionLabel,
  SpecRow,
} from "@/components/vtec/primitives";
import { fakeHex, txUrl } from "@/data/vtec";
import { bytes, num } from "@/lib/format";
import { hashPlan, planSentences } from "@/lib/plan";
import {
  ActionCard,
  FeatureRow,
  PrimaryAction,
  RightPanel,
  StageLayout,
} from "../shell";
import type { Saga } from "../useSaga";

export default function Stage5Seal({ saga }: { saga: Saga }) {
  const { state, set, advance } = saga;
  const plan = state.plan;
  const gpu = state.agent.gpu;
  const seal = state.seal;
  const [hash, setHash] = React.useState<string | null>(seal.planHash);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  React.useEffect(() => {
    if (!plan) return;
    if (seal.status === "sealed" && seal.planHash) {
      setHash(seal.planHash);
      return;
    }
    hashPlan(plan).then(setHash);
  }, [plan, seal.status, seal.planHash]);

  const sealed = seal.status === "sealed";
  const pending = seal.status === "pending";

  const commit = React.useCallback(() => {
    setDialogOpen(false);
    set((current) => ({
      ...current,
      seal: { ...current.seal, status: "pending" },
    }));
    window.setTimeout(() => {
      set((current) => ({
        ...current,
        seal: {
          ...current.seal,
          status: "sealed",
          tx: fakeHex(`${current.runId}-commit`, 64),
          planHash: hash,
          sealedAt: new Date().toISOString(),
        },
      }));
    }, 2200);
  }, [hash, set]);

  const signer =
    state.identity.path === "passkey"
      ? (state.identity.passkey?.address ?? null)
      : state.identity.walletAddress;

  const panel = (
    <RightPanel
      label="Seal"
      state={sealed ? "sealed" : pending ? "pending" : "unsealed"}
      tone={sealed ? "success" : pending ? "info" : "warning"}
      orb={state.agent.status === "found" ? "found" : "idle"}
      focal={
        <div className="flex flex-col items-center gap-4">
          <span
            className={cn(
              "inline-flex size-20 items-center justify-center rounded-full border transition-colors",
              sealed
                ? "border-[color-mix(in_oklab,var(--success)_45%,transparent)] text-[var(--success)]"
                : "border-border/60 text-muted-foreground",
              pending && "vtec-pulse",
            )}
          >
            {sealed ? (
              <LockIcon className="size-7" />
            ) : (
              <LockOpenIcon className="size-7" />
            )}
          </span>
          {hash ? (
            <code className="vtec-num px-2 text-xs leading-relaxed break-all text-muted-foreground">
              {hash}
            </code>
          ) : null}
          {sealed && seal.tx ? (
            <a
              href={txUrl(seal.chain, seal.tx)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              View the commit transaction
              <ExternalLinkIcon className="size-3" />
            </a>
          ) : null}
        </div>
      }
      helper={
        sealed
          ? "The rules are onchain. Nothing about them can change now."
          : pending
            ? "Waiting for the transaction to confirm."
            : "Nothing is locked until you commit."
      }
      blocked={
        sealed || pending ? undefined : "Committing cannot be undone."
      }
      pills={[
        seal.chain,
        sealed ? "sealed" : "not sealed",
        state.identity.path === "passkey" ? "passkey" : "external wallet",
      ]}
    />
  );

  return (
    <StageLayout
      headline="Seal the rules onchain."
      subhead="Sealing puts the plan hash onchain before any test runs. After this, we can't change them and neither can you. That's the point — otherwise you'd be trusting us, which is the problem this exists to fix."
      panel={panel}
    >
      <ActionCard
        n={1}
        title="What is about to be locked"
        why="This is the last moment anything here can change. Read it once more, because after the transaction confirms these fields are read-only for good."
        state={sealed ? "complete" : "active"}
      >
        {gpu && plan ? (
          <div className="flex flex-col">
            <SpecRow label="Card">
              {gpu.name} · {gpu.smCount} SM
            </SpecRow>
            <SpecRow label="Task">{plan.task}</SpecRow>
            <SpecRow label="Message length">
              {bytes(plan.messageLengthBytes)}
            </SpecRow>
            <SpecRow label="Job sizes">
              <span className="vtec-num">
                {plan.batchSizes.map(num).join(" / ")}
              </span>
            </SpecRow>
            <SpecRow label="Candidates">
              {plan.variantPool.length - 1} against the baseline
            </SpecRow>
            <SpecRow label="Signed by">
              {signer ? (
                <HashChip value={signer} lead={8} tail={6} copyable={false} />
              ) : (
                "—"
              )}
            </SpecRow>
            <SpecRow label="Plan hash">
              {hash ? <HashChip value={hash} /> : "computing…"}
            </SpecRow>
          </div>
        ) : null}
      </ActionCard>

      <ActionCard
        n={2}
        title="Commit the plan hash"
        why="The rules are locked before anyone knows the result. Otherwise you would be trusting us — which is the problem this product exists to fix."
        state={sealed ? "complete" : "active"}
      >
        <div className="flex flex-col">
          <FeatureRow icon={<ShieldCheckIcon />} title="commitPlan(bytes32)">
            One call, on {seal.chain}. It records the hash and nothing else —
            not the plan, not your card, not the result.
          </FeatureRow>
          <FeatureRow icon={<LockIcon />} title="Order is enforced">
            The run cannot start until this transaction has confirmed. That
            ordering is the entire onchain value.
          </FeatureRow>
        </div>

        {sealed && seal.tx ? (
          <>
            <Separator className="bg-border/40" />
            <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-muted/20 p-4">
              <div className="flex items-center gap-2">
                <LockIcon className="size-3.5 text-[var(--success)]" />
                <SectionLabel>Stages 1 to 3 are now read-only</SectionLabel>
                <Badge
                  variant="outline"
                  className="rounded-md border-[color-mix(in_oklab,var(--success)_45%,transparent)] px-2 py-0 text-[11px] font-normal text-[var(--success)]"
                >
                  sealed
                </Badge>
              </div>
              <div className="flex flex-col gap-1 text-sm text-muted-foreground">
                <span>
                  {gpu?.name} · {plan?.task} ·{" "}
                  <span className="vtec-num">
                    {plan?.batchSizes.map(num).join(" / ")}
                  </span>{" "}
                  messages per job
                </span>
                <span>
                  {plan ? planSentences(plan).length : 0} rules, fixed. Nobody
                  can edit them, including us.
                </span>
              </div>
              <a
                href={txUrl(seal.chain, seal.tx)}
                target="_blank"
                rel="noreferrer"
                className="vtec-num inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                {seal.tx.slice(0, 18)}…
                <ExternalLinkIcon className="size-3" />
              </a>
            </div>
          </>
        ) : null}

        <div className="flex items-center gap-3">
          {sealed ? (
            <PrimaryAction onClick={advance}>Continue</PrimaryAction>
          ) : (
            <PrimaryAction
              onClick={() => setDialogOpen(true)}
              disabled={!hash || pending}
            >
              {pending ? "Confirming…" : "Commit the plan hash"}
            </PrimaryAction>
          )}
          {!hash ? (
            <span className="text-xs text-muted-foreground">
              Waiting for the plan hash.
            </span>
          ) : null}
        </div>
      </ActionCard>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Seal these rules before any test runs?</DialogTitle>
            <DialogDescription>
              Committing writes the plan hash onchain now, before the first
              measurement exists. After it confirms, the rules cannot be changed
              — not by you, and not by us. That is what makes the result worth
              anything.
            </DialogDescription>
          </DialogHeader>
          {hash ? (
            <code className="vtec-num rounded-lg border border-border/60 px-3 py-3 text-xs leading-relaxed break-all">
              {hash}
            </code>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" className="rounded-full">
                Not yet
              </Button>
            </DialogClose>
            <Button className="h-11 rounded-full px-6" onClick={commit}>
              Commit and seal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StageLayout>
  );
}
