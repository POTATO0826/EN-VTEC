"use client";

import * as React from "react";
import {
  IDKitRequestWidget,
  selfieCheckLegacy,
  type IDKitResult,
  type RpContext,
} from "@worldcoin/idkit";
import { IDKitErrorCodes } from "@worldcoin/idkit";
import { AlertTriangleIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export type SignedRequest = {
  app_id: `app_${string}`;
  action: string;
  action_description?: string;
  environment: "production" | "staging" | "sandbox";
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
 * One World ID check (IDKit, Selfie Check). Same approach as lib/selfie-check:
 * the legacy preset, because Selfie Check is only issuable as a World ID 3.0
 * proof (the 4.0 route fails on real devices). The server signs the request
 * (`start`), the widget collects the proof, and `confirm` sends it back to the
 * server, which verifies it with World. The signal binds the proof to one
 * thing (a session, or a Sui address), so it can't be replayed for another.
 */

/** What World App's error codes mean for the person looking at the page. */
const WORLD_ERRORS: Partial<Record<string, { title: string; detail: string }>> = {
  [IDKitErrorCodes.UserRejected]: {
    title: "You declined in World App",
    detail: "Nothing was approved. Try again when you're ready.",
  },
  [IDKitErrorCodes.VerificationRejected]: {
    title: "Declined in World App",
    detail: "Nothing was approved. Try again when you're ready.",
  },
  [IDKitErrorCodes.CredentialUnavailable]: {
    title: "No Selfie Check on this World ID",
    detail: "Complete Selfie Check in World App first, then try again.",
  },
  [IDKitErrorCodes.FeatureUnavailable]: {
    title: "Selfie Check isn't enabled for this app",
    detail: "It's an access-gated beta: request the flag for this app_id from World.",
  },
};
export default function WorldIdButton({
  label,
  sessionId,
  signal,
  disabled,
  start,
  confirm,
  onDone,
}: {
  label: string;
  sessionId: string;
  /** What the proof is bound to. Defaults to the session id. */
  signal?: string;
  disabled?: boolean;
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

      <Button onClick={open} disabled={busy || disabled} className="w-fit rounded-full px-5">
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
          // Required: selfieCheckLegacy() only ever returns 3.0 proofs.
          allow_legacy_proofs
          preset={selfieCheckLegacy({ signal: signal ?? sessionId })}
          handleVerify={verify}
          onSuccess={() => setRequest(null)}
          onError={(code) => {
            // The denied path: say plainly what happened, approve nothing.
            setRequest(null);
            setError((current) =>
              current ?? WORLD_ERRORS[code] ?? { title: "World ID didn't complete", detail: String(code) },
            );
          }}
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
