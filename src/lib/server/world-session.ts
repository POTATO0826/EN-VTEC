import "server-only";
import { signRequest } from "@worldcoin/idkit-core/signing";
import { idkit, missingIdkitEnv } from "./world";
import {
  inspectSessionProof,
  type SessionExpectation,
} from "../recovery-proof";

export function sessionRequest() {
  if (missingIdkitEnv().length) throw new Error("World ID is not configured.");
  const signed = signRequest({ signingKeyHex: idkit.signingKey }); // No action for sessions.
  return {
    rp_id: idkit.rpId,
    nonce: signed.nonce,
    created_at: signed.createdAt,
    expires_at: signed.expiresAt,
    signature: signed.sig,
  };
}

export async function verifyWorldSession(
  value: unknown,
  expected: Omit<SessionExpectation, "environment">,
) {
  const checked = inspectSessionProof(value, {
    ...expected,
    environment: idkit.environment,
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (idkit.environment === "staging" && idkit.stagingToken)
    headers["x-staging-verification-token"] = idkit.stagingToken;
  const result = await fetch(
    `https://developer.world.org/api/v4/verify/${idkit.rpId}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(checked.proof),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const verdict = await result.json();
  if (
    !result.ok ||
    verdict.success !== true ||
    verdict.environment !== idkit.environment
  ) {
    throw new Error(
      "World could not verify this session in the configured environment.",
    );
  }
  if (verdict.session_id !== checked.sessionId)
    throw new Error("World returned a different session.");
  if (
    !Array.isArray(verdict.results) ||
    !verdict.results.some(
      (r: { identifier?: string; success?: boolean }) =>
        r.identifier === "selfie" && r.success === true,
    )
  ) {
    throw new Error(
      "World did not verify the required Selfie Check credential.",
    );
  }
  return checked;
}
