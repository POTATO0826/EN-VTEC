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

type SignedRequest = {
  app_id: `app_${string}`;
  action: string;
  environment: "production" | "staging";
  rp_context: RpContext;
};

const ERRORS: Record<string, string> = {
  world_not_configured: "World ID isn't set up on the server yet.",
  seat_taken: "This World ID already holds a tuner seat.",
  signal_mismatch: "The proof was made for a different session. Try again.",
  verification_failed: "World rejected the proof.",
};

/**
 * IDKit Proof of Human. The session id is the signal, so the proof only
 * counts for this browser session; the server checks it with World.
 */
export default function WorldIdVerify({
  sessionId,
  onVerified,
}: {
  sessionId: string;
  onVerified: () => void;
}) {
  const [request, setRequest] = React.useState<SignedRequest | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<{ title: string; detail: string } | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/world/rp-signature", { method: "POST" });
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
  const verify = async (result: IDKitResult) => {
    const res = await fetch("/api/world/claim-seat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, idkitResponse: result }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError({
        title: ERRORS[data.error] ?? "Verification failed",
        detail: [data.code, data.detail].filter(Boolean).join(": "),
      });
      throw new Error(data.error ?? "verification_failed");
    }
    onVerified();
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

      <Button onClick={start} disabled={busy} className="w-fit rounded-full px-5">
        {busy ? "Preparing…" : "Verify with World ID"}
      </Button>

      {request ? (
        <IDKitRequestWidget
          open
          onOpenChange={(open) => !open && setRequest(null)}
          app_id={request.app_id}
          action={request.action}
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
