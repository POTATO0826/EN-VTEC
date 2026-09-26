import { describe, expect, test } from "bun:test";
import { hashSignal } from "@worldcoin/idkit-core/hashing";
import {
  assertFreshStamps,
  inspectSessionProof,
} from "../src/lib/recovery-proof";

const expected = {
  nonce: "nonce",
  signal: "recover:wallet:request",
  environment: "production",
  sessionId: "session_aabb",
};
function proof() {
  return {
    protocol_version: "4.0",
    nonce: expected.nonce,
    session_id: expected.sessionId,
    environment: "production",
    integrity_bundle: {
      version: 2,
      timestamp: 123,
      signature_format: "apple_app_attest",
      signature: "sig",
      jwt: "jwt",
    },
    responses: [
      {
        identifier: "selfie",
        issuer_schema_id: 11,
        signal_hash: hashSignal(expected.signal),
        session_nullifier: ["0x01", "0x02"],
      },
    ],
  };
}

describe("World recovery context (cryptographic validation is a separate Portal call)", () => {
  test("accepts the enrolled session and normalizes replay stamps", () => {
    expect(inspectSessionProof(proof(), expected).stamps).toEqual(["1:2"]);
  });
  test("rejects another person's session", () => {
    expect(() =>
      inspectSessionProof({ ...proof(), session_id: "session_ccdd" }, expected),
    ).toThrow("enrolled");
  });
  test("rejects a changed payout signal", () => {
    expect(() =>
      inspectSessionProof(proof(), { ...expected, signal: "thief-wallet" }),
    ).toThrow("payout");
  });
  test("rejects missing signals and empty responses", () => {
    const p = proof();
    p.responses[0].signal_hash = "";
    expect(() => inspectSessionProof(p, expected)).toThrow("payout");
    expect(() =>
      inspectSessionProof({ ...p, responses: [] }, expected),
    ).toThrow("Exactly one");
  });
  test("rejects a stale nonce and staging proof in production", () => {
    expect(() =>
      inspectSessionProof({ ...proof(), nonce: "old" }, expected),
    ).toThrow("nonce");
    expect(() =>
      inspectSessionProof({ ...proof(), environment: "staging" }, expected),
    ).toThrow("environment");
  });
  test("rejects uniqueness proofs, missing integrity, and non-selfie credentials", () => {
    expect(() =>
      inspectSessionProof({ ...proof(), action: "approve" }, expected),
    ).toThrow("session proofs");
    expect(() =>
      inspectSessionProof(
        { ...proof(), integrity_bundle: undefined },
        expected,
      ),
    ).toThrow("Selfie");
    const p = proof();
    p.responses[0].issuer_schema_id = 1;
    expect(() => inspectSessionProof(p, expected)).toThrow("Selfie");
  });
  test("rejects replay even with differently padded hex fields", () => {
    const stamps = inspectSessionProof(proof(), expected).stamps;
    const p = proof();
    p.responses[0].session_nullifier = ["0x1", "0x0002"];
    expect(() =>
      assertFreshStamps(inspectSessionProof(p, expected).stamps, stamps),
    ).toThrow("already been used");
  });
});
