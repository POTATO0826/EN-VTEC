"use client";

import * as React from "react";
import { cn } from "cn";
import {
  AlertTriangleIcon,
  CheckIcon,
  FingerprintIcon,
  KeyRoundIcon,
  WalletIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { HashChip, SectionLabel } from "@/components/vtec/primitives";
import { useWallet, walletBridge } from "@/components/wallet/bridge";
import WorldIdCard from "@/components/world/WorldIdCard";
import {
  createPasskey,
  IDENTITY_PROVIDER_NOTE,
  PASSKEY_COPY,
  WALLET_COPY,
} from "@/lib/identity";
import {
  ActionCard,
  FeatureRow,
  PrimaryAction,
  RightPanel,
  StageLayout,
} from "../shell";
import type { Saga } from "../useSaga";

export default function Stage4Identity({ saga }: { saga: Saga }) {
  const { state, set, advance } = saga;
  const identity = state.identity;
  const wallet = useWallet();

  // The wallet lives in the shell. When it connects, the saga records that the
  // plan will be signed by it - the result card has to be able to say who
  // committed the plan.
  React.useEffect(() => {
    if (wallet.connected && !identity.walletAddress) {
      set((current) => ({
        ...current,
        identity: {
          ...current.identity,
          path: current.identity.passkey ? current.identity.path : "wallet",
          walletAddress: wallet.label,
          error: null,
        },
      }));
    }
  }, [wallet.connected, wallet.label, identity.walletAddress, set]);

  const startPasskey = React.useCallback(async () => {
    set((current) => ({
      ...current,
      identity: {
        ...current.identity,
        path: "passkey",
        passkeyStatus: "creating",
        error: null,
      },
    }));
    const result = await createPasskey();
    set((current) => ({
      ...current,
      identity: result.ok
        ? {
            ...current.identity,
            path: "passkey",
            passkeyStatus: "created",
            passkey: result.account,
            error: null,
          }
        : {
            ...current.identity,
            passkeyStatus: "failed",
            error: result.error,
          },
    }));
  }, [set]);

  const ready =
    (identity.path === "passkey" && !!identity.passkey) ||
    (identity.path === "wallet" && !!identity.walletAddress);

  const signer =
    identity.path === "passkey" && identity.passkey
      ? identity.passkey.address
      : identity.walletAddress;

  const panel = (
    <RightPanel
      label="Identity"
      state={
        ready
          ? "connected"
          : identity.passkeyStatus === "creating"
            ? "creating"
            : identity.passkeyStatus === "failed"
              ? "failed"
              : "waiting"
      }
      tone={
        ready
          ? "success"
          : identity.passkeyStatus === "failed"
            ? "danger"
            : identity.passkeyStatus === "creating"
              ? "info"
              : "muted"
      }
      orb={state.agent.status === "found" ? "found" : "idle"}
      focal={
        <div className="flex w-full flex-col items-center gap-3">
          <span
            className={cn(
              "inline-flex size-16 items-center justify-center rounded-full border",
              ready
                ? "border-[color-mix(in_oklab,var(--success)_45%,transparent)] text-[var(--success)]"
                : "border-border/60 text-muted-foreground",
            )}
          >
            {ready ? (
              <CheckIcon className="size-6" />
            ) : identity.path === "wallet" ? (
              <WalletIcon className="size-6" />
            ) : (
              <KeyRoundIcon className="size-6" />
            )}
          </span>
          <span className="text-sm">
            {ready
              ? identity.path === "passkey"
                ? "Passkey on this device"
                : "Existing wallet"
              : "No signer yet"}
          </span>
          {signer ? (
            <HashChip value={signer} lead={8} tail={6} copyable={false} />
          ) : null}
        </div>
      }
      helper={
        ready
          ? "This is what will sign the commit transaction at the next stage."
          : "Sealing needs a signature, so identity comes first."
      }
      blocked={ready ? undefined : "Create a passkey or connect a wallet first."}
      pills={
        ready
          ? [
              identity.path === "passkey" ? "passkey" : "external wallet",
              "signs the plan hash",
              identity.path === "wallet" && wallet.chain ? `on ${wallet.chain}` : "on device",
            ]
          : ["no signer", "sealing blocked"]
      }
    />
  );

  return (
    <StageLayout
      headline="Create the key that will sign the plan."
      subhead="Sealing needs a signature, so pick a passkey or a wallet to sign with. Then claim your tuner seat with World ID."
      panel={panel}
    >
      <div className="flex flex-col gap-4">
        {/* Passkey */}
        <ActionCard
          n={1}
          title={PASSKEY_COPY.title}
          why={PASSKEY_COPY.why}
          state={
            identity.passkey ? "complete" : identity.path === "wallet" ? "future" : "active"
          }
        >
          <Badge
            variant="outline"
            className="w-fit rounded-md border-border/60 px-2 py-0.5 text-[11px] font-normal text-muted-foreground"
          >
            recommended
          </Badge>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {PASSKEY_COPY.detail}
          </p>
          <div className="flex flex-col">
            <FeatureRow icon={<FingerprintIcon />} title="No seed phrase">
              The key is held by your device's authenticator, not by us.
            </FeatureRow>
            <FeatureRow icon={<KeyRoundIcon />} title="No extension">
              Nothing to install, and nothing to restore on a new machine unless
              you choose to.
            </FeatureRow>
          </div>

          {identity.passkeyStatus === "failed" && identity.error ? (
            <Alert variant="warning">
              <AlertTriangleIcon />
              <AlertTitle>Passkey not created</AlertTitle>
              <AlertDescription>{identity.error}</AlertDescription>
            </Alert>
          ) : null}

          {identity.passkey ? (
            <div className="flex flex-col gap-2">
              <SectionLabel>Embedded wallet</SectionLabel>
              <HashChip value={identity.passkey.address} />
            </div>
          ) : null}

          <PrimaryAction
            onClick={startPasskey}
            disabled={identity.passkeyStatus === "creating"}
            variant={identity.passkey ? "outline" : "default"}
          >
            {identity.passkeyStatus === "creating"
              ? "Waiting for your authenticator…"
              : identity.passkey
                ? "Create another passkey"
                : "Create a passkey"}
          </PrimaryAction>

          <p className="text-xs leading-relaxed text-muted-foreground">
            {IDENTITY_PROVIDER_NOTE}
          </p>
        </ActionCard>

        {/* Existing wallet */}
        <ActionCard
          n={2}
          title={WALLET_COPY.title}
          why={WALLET_COPY.why}
          state={
            identity.walletAddress
              ? "complete"
              : identity.path === "passkey"
                ? "future"
                : "active"
          }
        >
          <p className="text-sm leading-relaxed text-muted-foreground">
            This opens the wallet connect that is already in this app, in the
            header where it has always been. There is no second wallet here.
          </p>
          <div className="flex flex-col">
            <FeatureRow icon={<WalletIcon />} title="Your existing signer">
              The plan hash is signed the same way whichever path you take.
            </FeatureRow>
          </div>

          {identity.walletAddress ? (
            <div className="flex flex-col gap-2">
              <SectionLabel>Connected</SectionLabel>
              <span className="text-sm">{identity.walletAddress}</span>
            </div>
          ) : null}

          <PrimaryAction
            variant={identity.walletAddress ? "outline" : "default"}
            onClick={() => {
              set((current) => ({
                ...current,
                identity: { ...current.identity, path: "wallet" },
              }));
              walletBridge.open();
            }}
          >
            {identity.walletAddress
              ? "Manage in the header"
              : "Connect a wallet"}
          </PrimaryAction>
        </ActionCard>
      </div>

      <WorldIdCard />

      <div className="flex items-center gap-3">
        <PrimaryAction onClick={advance} disabled={!ready}>
          Continue to sealing
        </PrimaryAction>
        {!ready ? (
          <span className="text-xs text-muted-foreground">
            Sealing needs a signature. Pick one of the two paths above.
          </span>
        ) : null}
      </div>
    </StageLayout>
  );
}
