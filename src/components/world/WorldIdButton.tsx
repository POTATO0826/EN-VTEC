"use client";

import * as React from "react";
import {
  IDKitRequestWidget,
  proofOfHuman,
  type IDKitResult,
  type RpContext,
} from "@worldcoin/idkit";
import { AlertTriangleIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export type SignedRequest = {
  app_id: `app_${string}`;
  action: string;
  action_description?: string;
  environment: "production" | "staging";
  rp_context: RpContext;
  [extra: string]: unknown;
};

const ERRORS: Record<string, string> = {
  world_not_configured: "World ID isn't set up on the server yet.",
  seat_taken: "This World ID already holds a tuner seat.",
  signal_mismatch: "The proof was made for a different session. Try again.",
  wrong_action: "The proof was made for a different request. Try again.",
  verification_failed: "World rejected the proof.",
  no_seat: "Claim your World ID seat on Get started first.",
};

/**
 * One World ID check (IDKit, Proof of Human). The server signs the request
 * (`start`), the widget collects the proof, and `confirm` sends it back to the
 * server, which verifies it with World. The session id is always the signal.
 */
export default function WorldIdButton({
  label,
  sessionId,
  start,
  confirm,
  onDone,
}: {
  label: string;
  sessionId: string;
  start: () => Promise<Response>;
  confirm: (proof: IDKitResult, request: SignedRequest) => Promise<Response>;
  onDone: () => void;
}) {
  const [request, setRequest] = React.useState<SignedRequest | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<{ title: string; detail: string } | null>(null);

  const open = async () => {
    setBusy(true);
    setError(null);
    const res = await start();
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError({
        title: ERRORS[data.error] ?? "Couldn't start World ID",
        detail: data.missing ? `Missing in .env.local: ${data.missing.join(", ")}` : "",
      });
      return;
    }
    setRequest(data as SignedRequest);
  };

  // Runs inside the widget: throwing makes World's UI show the failure.
  const verify = async (proof: IDKitResult) => {
    const res = await confirm(proof, request!);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError({
        title: ERRORS[data.error] ?? "Verification failed",
        detail: [data.code, data.detail].filter(Boolean).join(": "),
      });
      throw new Error(data.error ?? "verification_failed");
    }
    onDone();
  };

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <Alert variant="warning">
          <AlertTriangleIcon />
          <AlertTitle>{error.title}</AlertTitle>
          {error.detail ? <AlertDescription>{error.detail}</AlertDescription> : null}
        </Alert>
      ) : null}

      <Button onClick={open} disabled={busy} className="w-fit rounded-full px-5">
        {busy ? "Preparing…" : label}
      </Button>

      {request ? (
        <IDKitRequestWidget
          open
          onOpenChange={(isOpen) => !isOpen && setRequest(null)}
          app_id={request.app_id}
          action={request.action}
          action_description={request.action_description}
          environment={request.environment}
          rp_context={request.rp_context}
          allow_legacy_proofs
          preset={proofOfHuman({ signal: sessionId })}
          handleVerify={verify}
          onSuccess={() => setRequest(null)}
        />
      ) : null}
    </div>
  );
}

export function postJson(url: string, body: unknown) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
