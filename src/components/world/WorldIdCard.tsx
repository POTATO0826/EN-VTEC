"use client";

import * as React from "react";
import {
  IDKitRequestWidget,
  proofOfHuman,
  type IDKitResult,
  type RpContext,
} from "@worldcoin/idkit";
import { AlertTriangleIcon, CheckIcon, ScanFaceIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { HashChip, SectionLabel } from "@/components/vtec/primitives";
import { useWallet, walletBridge } from "@/components/wallet/bridge";
import { ActionCard, FeatureRow, PrimaryAction } from "@/components/wizard/shell";

type Request = {
  app_id: `app_${string}`;
  action: string;
  environment: "production" | "staging";
  rp_context: RpContext;
};

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "open"; request: Request }
  | { kind: "verified"; nullifier: string }
  | { kind: "error"; title: string; detail: string };

const ERRORS: Record<string, string> = {
  world_not_configured: "World ID isn't set up on the server yet.",
  seat_taken: "This World ID already claimed a tuner seat.",
  signal_mismatch: "The proof was made for a different wallet. Try again.",
  verification_failed: "World's Developer Portal rejected the proof.",
};

/**
 * Proof of Human for the tuner seat: one real person, one seat. The proof is
 * bound to the connected wallet (the wallet address is the signal), and the
 * server checks it with World before anything is recorded.
 */
export default function WorldIdCard({
  onVerified,
}: {
  onVerified?: (nullifier: string) => void;
}) {
  const wallet = useWallet();
  const [status, setStatus] = React.useState<Status>({ kind: "idle" });

  const start = async () => {
    setStatus({ kind: "loading" });
    const res = await fetch("/api/rp-signature", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus({
        kind: "error",
        title: ERRORS[data.error] ?? "Couldn't start World ID",
        detail: data.missing ? `Missing: ${data.missing.join(", ")}` : "",
      });
      return;
    }
    setStatus({ kind: "open", request: data as Request });
  };

  // Runs inside the widget, so a failure here shows as a failure in World's UI.
  const verify = async (result: IDKitResult) => {
    const res = await fetch("/api/verify-proof", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idkitResponse: result, wallet: wallet.address }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus({
        kind: "error",
        title: ERRORS[data.error] ?? "Verification failed",
        detail: [data.code, data.detail].filter(Boolean).join(": "),
      });
      throw new Error(data.error ?? "verification_failed");
    }
    setStatus({ kind: "verified", nullifier: data.nullifier });
    onVerified?.(data.nullifier);
  };

  const verified = status.kind === "verified";

  return (
    <ActionCard
      n={3}
      title="Claim a tuner seat with World ID"
      why="Leaderboards only mean something if one person can't enter a hundred times."
      state={verified ? "complete" : wallet.connected ? "active" : "future"}
    >
      <div className="flex flex-col">
        <FeatureRow icon={<ScanFaceIcon />} title="One human, one seat">
          World App proves you're a unique person without telling us who you are.
        </FeatureRow>
        <FeatureRow icon={<CheckIcon />} title="Tied to your wallet">
          The proof is made for the wallet you connected, so it can't be reused
          for another one.
        </FeatureRow>
      </div>

      {status.kind === "error" ? (
        <Alert variant="warning">
          <AlertTriangleIcon />
          <AlertTitle>{status.title}</AlertTitle>
          {status.detail ? <AlertDescription>{status.detail}</AlertDescription> : null}
        </Alert>
      ) : null}

      {verified ? (
        <div className="flex flex-col gap-2">
          <SectionLabel>Seat claimed · nullifier</SectionLabel>
          <HashChip value={status.nullifier} lead={10} tail={6} />
        </div>
      ) : wallet.connected ? (
        <PrimaryAction onClick={start} disabled={status.kind === "loading"}>
          {status.kind === "loading" ? "Preparing…" : "Verify with World ID"}
        </PrimaryAction>
      ) : (
        <PrimaryAction variant="outline" onClick={() => walletBridge.open()}>
          Connect MetaMask first
        </PrimaryAction>
      )}

      {status.kind === "open" && wallet.address ? (
        <IDKitRequestWidget
          open
          onOpenChange={(open) => {
            if (!open) setStatus((s) => (s.kind === "open" ? { kind: "idle" } : s));
          }}
          app_id={status.request.app_id}
          action={status.request.action}
          environment={status.request.environment}
          rp_context={status.request.rp_context}
          allow_legacy_proofs
          preset={proofOfHuman({ signal: wallet.address.toLowerCase() })}
          handleVerify={verify}
          onSuccess={() => {}}
        />
      ) : null}
    </ActionCard>
  );
}
