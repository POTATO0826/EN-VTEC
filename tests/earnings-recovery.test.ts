import { beforeEach, describe, expect, mock, test } from "bun:test";
import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { inspectSessionProof } from "../src/lib/recovery-proof";
import type { RecoveryState } from "../src/lib/server/recovery-state";

mock.module("server-only", () => ({}));
const OLD = `0x${"1".repeat(64)}`;
const NEW = `0x${"2".repeat(64)}`;
let state: RecoveryState;
let signed = 0;
let executed = 0;
let outage = false;
let chainRejects = false;
let portalRejects = false;
let walletSignatureValid = true;
let nonce = 0;

// Preserve real account/locking helpers; substitute only durable IO in this test.
const actualState = await import("../src/lib/server/recovery-state");
mock.module("../src/lib/server/recovery-state", () => ({
  ...actualState,
  readRecovery: async () => structuredClone(state),
  saveRecovery: async (value: RecoveryState) => {
    state = structuredClone(value);
  },
}));
mock.module("../src/lib/server/world", () => ({
  idkit: { appId: "app_test", environment: "production" },
}));
mock.module("../src/lib/server/world-session", () => ({
  sessionRequest: () => ({
    rp_id: "rp_test",
    nonce: `nonce-${++nonce}`,
    created_at: Date.now() / 1000,
    expires_at: Date.now() / 1000 + 300,
    signature: "rp-signature",
  }),
  verifyWorldSession: async (
    value: unknown,
    expected: Parameters<typeof inspectSessionProof>[1],
  ) => {
    if (portalRejects) throw new Error("Portal rejected proof");
    return inspectSessionProof(value, {
      ...expected,
      environment: "production",
    });
  },
}));
mock.module("../src/lib/server/sui", () => ({
  sui: { network: "testnet", packageId: "package" },
  adminReady: () => true,
  findHumanPass: async () => "pass",
  checkSignature: async () => walletSignatureValid,
  prepareEarningsRecovery: async () => {
    expect(state.usedStamps.length).toBeGreaterThan(0);
    signed++;
    return {
      bytes: "signed-bytes",
      signature: "signature",
      digest: "tx-digest",
    };
  },
  executeEarningsRecovery: async (tx: { bytes: string }) => {
    expect(state.requests.some((r) => r.transaction?.bytes === tx.bytes)).toBe(
      true,
    );
    executed++;
    if (outage) throw new Error("network timeout");
    return { success: !chainRejects, digest: "tx-digest" };
  },
}));
const { startEarningsRequest, confirmEarningsRequest } =
  await import("../src/lib/server/earnings-recovery");

function proof(
  request: { rp_context: { nonce: string }; signal: string },
  session = "session_aabb",
) {
  return {
    protocol_version: "4.0",
    nonce: request.rp_context.nonce,
    session_id: session,
    environment: "production",
    integrity_bundle: { version: 2 },
    responses: [
      {
        identifier: "selfie",
        issuer_schema_id: 11,
        signal_hash: hashSignal(request.signal),
        session_nullifier: ["0x01", "0x02"],
      },
    ],
  };
}
beforeEach(() => {
  state = {
    accounts: [
      {
        identity: OLD,
        address: OLD,
        aliases: [OLD],
        worldSessionId: "session_aabb",
        challenges: ["challenge"],
      },
    ],
    requests: [],
    usedStamps: [],
  };
  signed = executed = nonce = 0;
  outage = portalRejects = chainRejects = false;
  walletSignatureValid = true;
});

describe("AdminCap recovery authorization and journal", () => {
  test("confirmed chain failure keeps the old payout and cannot reuse the proof", async () => {
    const request = await startEarningsRequest({
      kind: "recover",
      address: OLD,
      newAddress: NEW,
    });
    chainRejects = true;
    await expect(
      confirmEarningsRequest({ id: request.id, proof: proof(request) }),
    ).rejects.toThrow("Sui rejected");
    expect(state.accounts[0].address).toBe(OLD);
    expect(state.requests[0].status).toBe("failed");
    expect(state.usedStamps).toEqual(["1:2"]);
    await expect(confirmEarningsRequest({ id: request.id })).rejects.toThrow(
      "Sui rejected",
    );
    expect(signed).toBe(1);
    expect(executed).toBe(1);
  });
  test("concurrent confirmations execute only one recovery", async () => {
    const request = await startEarningsRequest({
      kind: "recover",
      address: OLD,
      newAddress: NEW,
    });
    await Promise.all([
      confirmEarningsRequest({ id: request.id, proof: proof(request) }),
      confirmEarningsRequest({ id: request.id, proof: proof(request) }),
    ]);
    expect(signed).toBe(1);
    expect(executed).toBe(1);
  });
  test("no old-wallet signature is needed after a verified session", async () => {
    const request = await startEarningsRequest({
      kind: "recover",
      address: OLD,
      newAddress: NEW,
    });
    const result = await confirmEarningsRequest({
      id: request.id,
      proof: proof(request),
    });
    expect(result.digest).toBe("tx-digest");
    expect(state.accounts[0].address).toBe(NEW);
    expect(signed).toBe(1);
  });
  test("wrong session, changed signal, and Portal rejection never reach AdminCap", async () => {
    const request = await startEarningsRequest({
      kind: "recover",
      address: OLD,
      newAddress: NEW,
    });
    await expect(
      confirmEarningsRequest({
        id: request.id,
        proof: proof(request, "session_ccdd"),
      }),
    ).rejects.toThrow("enrolled");
    const altered = proof(request);
    altered.responses[0].signal_hash = hashSignal("thief");
    await expect(
      confirmEarningsRequest({ id: request.id, proof: altered }),
    ).rejects.toThrow("payout");
    portalRejects = true;
    await expect(
      confirmEarningsRequest({ id: request.id, proof: proof(request) }),
    ).rejects.toThrow("Portal");
    expect(signed).toBe(0);
    expect(executed).toBe(0);
  });
  test("consumed proof stamps cannot authorize another recovery", async () => {
    state.usedStamps.push("1:2");
    const request = await startEarningsRequest({
      kind: "recover",
      address: OLD,
      newAddress: NEW,
    });
    await expect(
      confirmEarningsRequest({ id: request.id, proof: proof(request) }),
    ).rejects.toThrow("already been used");
    expect(signed).toBe(0);
  });
  test("expired requests fail closed", async () => {
    const request = await startEarningsRequest({
      kind: "recover",
      address: OLD,
      newAddress: NEW,
    });
    state.requests[0].expiresAt = 0;
    await expect(
      confirmEarningsRequest({ id: request.id, proof: proof(request) }),
    ).rejects.toThrow("expired");
    expect(signed).toBe(0);
  });
  test("retry after an uncertain broadcast reuses journaled bytes", async () => {
    const request = await startEarningsRequest({
      kind: "recover",
      address: OLD,
      newAddress: NEW,
    });
    outage = true;
    await expect(
      confirmEarningsRequest({ id: request.id, proof: proof(request) }),
    ).rejects.toThrow("timeout");
    expect(state.accounts[0].address).toBe(OLD);
    await expect(
      startEarningsRequest({ kind: "recover", address: OLD, newAddress: NEW }),
    ).rejects.toThrow("awaiting settlement");
    outage = false;
    await confirmEarningsRequest({ id: request.id });
    await confirmEarningsRequest({ id: request.id });
    expect(signed).toBe(1);
    expect(executed).toBe(2);
    expect(state.accounts[0].address).toBe(NEW);
  });
  test("a stolen wallet cannot replace an enrolled World session", async () => {
    await expect(
      startEarningsRequest({ kind: "enroll", address: OLD }),
    ).rejects.toThrow("already enrolled");
    expect(signed).toBe(0);
  });
  test("initial enrollment needs the current wallet's signature", async () => {
    delete state.accounts[0].worldSessionId;
    const request = await startEarningsRequest({
      kind: "enroll",
      address: OLD,
    });
    walletSignatureValid = false;
    await expect(
      confirmEarningsRequest({
        id: request.id,
        proof: proof(request),
        signature: "wrong",
      }),
    ).rejects.toThrow("must sign");
    expect(state.accounts[0].worldSessionId).toBeUndefined();
    walletSignatureValid = true;
    await confirmEarningsRequest({
      id: request.id,
      proof: proof(request),
      signature: "valid",
    });
    expect(state.accounts[0].worldSessionId).toBe("session_aabb");
    expect(signed).toBe(0);
  });
});
