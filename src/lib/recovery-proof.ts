import { hashSignal } from "@worldcoin/idkit-core/hashing";
import type { IDKitResultSession } from "@worldcoin/idkit";

export type SessionExpectation = {
  nonce: string;
  signal: string;
  environment: string;
  sessionId?: string;
};

function field(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^0x[0-9a-f]+$/i.test(value) ||
    value.length > 66
  ) {
    throw new Error("Malformed proof field.");
  }
  return BigInt(value).toString(16);
}

/** Structural/context checks supplement, never replace, Portal verification. */
export function inspectSessionProof(
  value: unknown,
  expected: SessionExpectation,
) {
  if (!value || typeof value !== "object")
    throw new Error("A World session proof is required.");
  const proof = value as IDKitResultSession;
  if (proof.protocol_version !== "4.0" || "action" in proof)
    throw new Error("Only World v4 session proofs are accepted.");
  if (
    typeof proof.session_id !== "string" ||
    !/^session_[0-9a-f]+$/i.test(proof.session_id)
  ) {
    throw new Error("Missing World session ID.");
  }
  if (expected.sessionId && proof.session_id !== expected.sessionId)
    throw new Error("This is not the enrolled World session.");
  if (
    proof.environment !== expected.environment ||
    proof.nonce !== expected.nonce
  )
    throw new Error("Wrong proof environment or request nonce.");
  if (!Array.isArray(proof.responses) || proof.responses.length !== 1)
    throw new Error("Exactly one Selfie Check response is required.");
  const response = proof.responses[0];
  if (
    response.identifier !== "selfie" ||
    response.issuer_schema_id !== 11 ||
    !proof.integrity_bundle
  ) {
    throw new Error(
      "Recovery requires World Selfie Check with app integrity verification.",
    );
  }
  if (
    !response.signal_hash ||
    field(response.signal_hash) !== field(hashSignal(expected.signal))
  ) {
    throw new Error(
      "Proof does not authorize this payout address and request.",
    );
  }
  if (
    !Array.isArray(response.session_nullifier) ||
    response.session_nullifier.length !== 2
  )
    throw new Error("Missing replay stamp.");
  // Canonicalize both fields to prevent 0x01 / 0x1 replay bypasses.
  const stamp = response.session_nullifier.map(field).join(":");
  return { proof, sessionId: proof.session_id, stamps: [stamp] };
}

export function assertFreshStamps(stamps: string[], used: string[]) {
  if (stamps.some((stamp) => used.includes(stamp)))
    throw new Error("This World session proof has already been used.");
}
