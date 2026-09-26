"use client";

import * as React from "react";
import {
  CredentialRequest,
  IDKitSessionWidget,
  type IDKitResultSession,
  type RpContext,
} from "@worldcoin/idkit";
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { Button } from "@/components/ui/button";
import SlushConnect from "@/components/sui/SlushConnect";
import { explorerTx } from "@/lib/sui-tx";

type SessionRequest = {
  id: string;
  kind: "enroll" | "recover";
  app_id: `app_${string}`;
  environment: "production" | "staging" | "sandbox";
  rp_context: RpContext;
  signal: string;
  message: string;
  existing_session_id?: `session_${string}`;
  address: string;
};
type Outcome = { kind: "enroll" | "recover"; address: string; digest?: string };
const SAVED = "vtec.earnings.pending";

async function post(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Request failed.");
  return result;
}

export default function EarningsRecovery() {
  const wallet = useCurrentAccount();
  const dAppKit = useDAppKit();
  const [oldAddress, setOldAddress] = React.useState("");
  const [newAddress, setNewAddress] = React.useState("");
  const [request, setRequest] = React.useState<SessionRequest | null>(null);
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [outcome, setOutcome] = React.useState<Outcome | null>(null);

  React.useEffect(() => {
    setPendingId(localStorage.getItem(SAVED));
  }, []);
  function complete(result: Outcome) {
    setOutcome(result);
    setError("");
    setPendingId(null);
    localStorage.removeItem(SAVED);
  }
  async function start(kind: "enroll" | "recover") {
    setBusy(true);
    setError("");
    setOutcome(null);
    try {
      const result = await post("/api/earnings/start", {
        kind,
        address: kind === "enroll" ? wallet?.address : oldAddress.trim(),
        newAddress: newAddress.trim(),
      });
      setRequest(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to start.");
    } finally {
      setBusy(false);
    }
  }
  async function verify(proof: IDKitResultSession) {
    if (!request) throw new Error("Missing request.");
    setBusy(true);
    try {
      let signature: string | undefined;
      if (request.kind === "enroll") {
        if (wallet?.address.toLowerCase() !== request.address)
          throw new Error("Reconnect the wallet that started enrollment.");
        const message = `${request.message}\nWorld session: ${proof.session_id}`;
        signature = (
          await dAppKit.signPersonalMessage({
            message: new TextEncoder().encode(message),
          })
        ).signature;
      }
      // Persist the operation ID before submission, so a timeout can be resumed
      // without collecting another proof or authorizing a different transaction.
      localStorage.setItem(SAVED, request.id);
      setPendingId(request.id);
      complete(
        await post("/api/earnings/confirm", {
          id: request.id,
          proof,
          signature,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed.");
      throw e;
    } finally {
      setBusy(false);
    }
  }
  async function resume() {
    setBusy(true);
    setError("");
    try {
      complete(await post("/api/earnings/confirm", { id: pendingId }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to resume.");
    } finally {
      setBusy(false);
    }
  }
  const inputStyle =
    "w-full rounded-lg border border-border bg-black/30 px-3 py-3 font-mono text-sm outline-none focus:border-foreground";

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          WORLD ID · SUI ROYALTIES
        </p>
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
          Lose your keys. Keep your income.
        </h1>
        <p className="text-muted-foreground">
          Protect your tuner earnings with World ID. If your payout wallet is
          lost or stolen, prove your enrolled World session to send future
          royalties to a new wallet.
        </p>
      </div>

      <section
        className="space-y-4 rounded-xl border border-border bg-card/80 p-6"
        aria-labelledby="enroll-title"
      >
        <h2 id="enroll-title" className="text-lg font-semibold">
          1. Protect your earnings
        </h2>
        <p className="text-sm text-muted-foreground">
          Do this before losing your keys. Connect the wallet holding your
          HumanPass, complete World Selfie Check, then sign to bind that World
          session to your royalty account. A wallet signature cannot replace an
          enrolled session.
        </p>
        <SlushConnect />
        <Button
          disabled={!wallet || busy || !!request}
          onClick={() => start("enroll")}
        >
          Enable earnings recovery
        </Button>
      </section>

      <section
        className="space-y-4 rounded-xl border border-border bg-card/80 p-6"
        aria-labelledby="recover-title"
      >
        <h2 id="recover-title" className="text-lg font-semibold">
          2. Recover my earnings
        </h2>
        <p className="text-sm text-muted-foreground">
          No access to the old wallet is needed. Enter a previously registered
          payout address to find your account, then the new wallet you control.
        </p>
        <label className="block space-y-2 text-sm">
          <span>Previous payout wallet</span>
          <input
            className={inputStyle}
            value={oldAddress}
            onChange={(e) => setOldAddress(e.target.value)}
            placeholder="0x…"
            autoComplete="off"
            spellCheck={false}
            disabled={busy || !!request}
          />
        </label>
        <label className="block space-y-2 text-sm">
          <span>New payout wallet</span>
          <input
            className={inputStyle}
            value={newAddress}
            onChange={(e) => setNewAddress(e.target.value)}
            placeholder="0x…"
            autoComplete="off"
            spellCheck={false}
            disabled={busy || !!request}
          />
        </label>
        {wallet && (
          <Button
            variant="outline"
            disabled={busy || !!request}
            onClick={() => setNewAddress(wallet.address)}
          >
            Use connected wallet as destination
          </Button>
        )}
        <p className="text-sm text-muted-foreground">
          Check the full destination address. World Selfie Check authorizes this
          exact change. After Sui confirms, future sales pay the new wallet and
          the old royalty badges become invalid.
        </p>
        <Button
          disabled={
            busy || !!request || !oldAddress.trim() || !newAddress.trim()
          }
          onClick={() => start("recover")}
        >
          Verify with World & recover
        </Button>
      </section>

      {busy && (
        <p role="status" className="text-sm text-muted-foreground">
          Processing your request. Confirm in World or your wallet when
          prompted…
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-500/40 p-4 text-sm text-red-300"
        >
          {error}
        </p>
      )}
      {pendingId && !busy && (
        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            If verification succeeded but settlement was interrupted, resume the
            saved operation. If verification failed, start a fresh request
            instead.
          </p>
          <Button variant="outline" onClick={resume}>
            Resume saved operation
          </Button>
        </div>
      )}
      {outcome && (
        <div
          role="status"
          className="space-y-2 rounded-xl border border-emerald-400/40 p-5"
        >
          <p className="font-medium">
            {outcome.kind === "enroll"
              ? "Earnings recovery enabled"
              : "Future earnings redirected"}
          </p>
          <p className="break-all font-mono text-sm">{outcome.address}</p>
          {outcome.digest && (
            <a
              href={explorerTx(outcome.digest)}
              target="_blank"
              rel="noreferrer"
              className="text-sm underline"
            >
              View the recovery transaction on Sui
            </a>
          )}
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        Recovery protects future royalty payments, not coins already paid or
        stolen. Your backend verifies World proofs and holds the Sui admin
        capability; World does not directly execute the Sui transaction.
      </p>
      {request && (
        <IDKitSessionWidget
          open
          onOpenChange={(open) => !open && setRequest(null)}
          app_id={request.app_id}
          environment={request.environment}
          rp_context={request.rp_context}
          existing_session_id={request.existing_session_id}
          action_description={
            request.kind === "enroll"
              ? "Protect Opti-om earnings"
              : `Recover Opti-om earnings to ${request.address}`
          }
          constraints={CredentialRequest("selfie", { signal: request.signal })}
          handleVerify={verify}
          onSuccess={() => setRequest(null)}
          onError={(code) => {
            setRequest(null);
            setError(
              (existing) =>
                existing || `World verification did not complete: ${code}`,
            );
          }}
        />
      )}
    </div>
  );
}
