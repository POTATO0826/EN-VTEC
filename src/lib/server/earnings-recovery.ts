import "server-only";
import { randomUUID } from "node:crypto";
import { idkit } from "./world";
import { sessionRequest, verifyWorldSession } from "./world-session";
import { assertFreshStamps } from "../recovery-proof";
import {
  accountFor,
  assertNoRecoveryInFlight,
  ensureAccount,
  readRecovery,
  saveRecovery,
  withRoyaltyLock,
  type RecoveryRequest,
} from "./recovery-state";
import {
  adminReady,
  checkSignature,
  executeEarningsRecovery,
  findHumanPass,
  prepareEarningsRecovery,
  sui,
} from "./sui";

function address(value: unknown) {
  if (
    typeof value !== "string" ||
    !/^0x[0-9a-f]{64}$/i.test(value) ||
    BigInt(value) === 0n
  )
    throw new Error("Enter a nonzero, full Sui wallet address.");
  return value.toLowerCase();
}

export function startEarningsRequest(input: {
  kind?: unknown;
  address?: unknown;
  newAddress?: unknown;
}) {
  return withRoyaltyLock(async () => {
    if (!adminReady()) throw new Error("Sui recovery is not configured.");
    if (input.kind !== "enroll" && input.kind !== "recover")
      throw new Error("Unknown recovery operation.");
    const oldAddress = address(input.address);
    const state = await readRecovery();
    let account = accountFor(state, oldAddress);
    if (input.kind === "enroll") {
      if (account?.worldSessionId)
        throw new Error(
          "Recovery is already enrolled. Its World session cannot be replaced with a wallet signature.",
        );
      if (!(await findHumanPass(oldAddress)))
        throw new Error(
          "Register with World ID and mint your HumanPass first.",
        );
      account = ensureAccount(state, oldAddress);
      if (account.address !== oldAddress)
        throw new Error("Use the current payout wallet to enroll.");
    }
    if (!account) throw new Error("No royalty account found for this address.");
    assertNoRecoveryInFlight(state, account.identity);
    const destination =
      input.kind === "enroll" ? oldAddress : address(input.newAddress);
    if (
      state.requests.some(
        (r) =>
          r.identity !== account.identity &&
          r.address === destination &&
          (r.status === "verified" || r.status === "prepared"),
      )
    ) {
      throw new Error("That destination is reserved by an unsettled recovery.");
    }
    if (input.kind === "recover") {
      if (!account.worldSessionId)
        throw new Error(
          "This account did not enroll World session recovery before losing its keys.",
        );
      if (!account.challenges.length)
        throw new Error(
          "No recoverable royalties yet. Legacy listings must be relisted.",
        );
      if (destination === account.address)
        throw new Error("Choose a different payout wallet.");
      const other = accountFor(state, destination);
      if (other && other.identity !== account.identity)
        throw new Error("That wallet belongs to another royalty account.");
    }
    const id = randomUUID();
    const rp = sessionRequest();
    const signal = `vtec:${input.kind}:${sui.network}:${sui.packageId}:${account.identity}:${destination}:${id}`;
    const record: RecoveryRequest = {
      id,
      kind: input.kind,
      identity: account.identity,
      address: destination,
      signal,
      message: `Opti-om enroll earnings recovery\nWallet: ${destination}\nRequest: ${id}\nSignal: ${signal}`,
      rp,
      expiresAt: rp.expires_at * 1000,
      worldSessionId: account.worldSessionId,
      status: "pending",
    };
    // Expired unverified requests have no security value. Keep completed records and consumed stamps.
    state.requests = state.requests.filter(
      (r) => r.status !== "pending" || r.expiresAt > Date.now(),
    );
    state.requests.push(record);
    await saveRecovery(state);
    return {
      id,
      kind: record.kind,
      app_id: idkit.appId,
      environment: idkit.environment,
      rp_context: rp,
      signal,
      message: record.message,
      existing_session_id: record.worldSessionId,
      expiresAt: record.expiresAt,
      address: destination,
    };
  });
}

export function confirmEarningsRequest(input: {
  id?: unknown;
  proof?: unknown;
  signature?: unknown;
}) {
  return withRoyaltyLock(async () => {
    const state = await readRecovery();
    const request = state.requests.find((r) => r.id === input.id);
    if (!request) throw new Error("Unknown earnings recovery request.");
    const account = state.accounts.find((a) => a.identity === request.identity);
    if (!account) throw new Error("Unknown royalty account.");
    if (request.status === "complete")
      return {
        ok: true,
        digest: request.digest,
        address: request.address,
        kind: request.kind,
      };
    if (request.status === "failed")
      throw new Error(
        "Sui rejected this transaction. Start a new request and proof.",
      );
    if (request.status === "pending") {
      if (request.expiresAt <= Date.now())
        throw new Error(
          "Request expired. Start again for a fresh World proof.",
        );
      assertNoRecoveryInFlight(state, account.identity);
      if (request.kind === "enroll" && account.worldSessionId)
        throw new Error("Recovery has already been enrolled.");
      if (
        request.kind === "recover" &&
        (!account.worldSessionId ||
          request.worldSessionId !== account.worldSessionId)
      )
        throw new Error("Recovery session changed.");
      const verified = await verifyWorldSession(input.proof, {
        nonce: request.rp.nonce,
        signal: request.signal,
        sessionId: request.worldSessionId,
      });
      assertFreshStamps(verified.stamps, state.usedStamps);
      if (request.kind === "enroll") {
        // Bind the specific verified session to a signed authorization by the
        // still-controlled wallet. Browser session IDs are never authorization.
        const message = `${request.message}\nWorld session: ${verified.sessionId}`;
        if (
          typeof input.signature !== "string" ||
          !(await checkSignature(message, input.signature, account.address))
        ) {
          throw new Error(
            "The current payout wallet must sign the enrollment of this World session.",
          );
        }
        if (state.accounts.some((a) => a.worldSessionId === verified.sessionId))
          throw new Error("This World session is already enrolled.");
        account.worldSessionId = verified.sessionId;
        account.enrolledAt = new Date().toISOString();
        request.status = "complete";
      } else {
        const other = accountFor(state, request.address);
        if (other && other.identity !== account.identity)
          throw new Error(
            "Destination wallet is already registered to another account.",
          );
        if (
          state.requests.some(
            (r) =>
              r.identity !== account.identity &&
              r.address === request.address &&
              (r.status === "verified" || r.status === "prepared"),
          )
        ) {
          throw new Error(
            "That destination is reserved by an unsettled recovery.",
          );
        }
        request.status = "verified";
      }
      request.stamps = verified.stamps;
      state.usedStamps.push(...verified.stamps);
      await saveRecovery(state); // Reserve stamps BEFORE any AdminCap transaction.
    }
    if (request.kind === "enroll")
      return { ok: true, kind: request.kind, address: account.address };
    if (request.status === "verified") {
      request.transaction = await prepareEarningsRecovery(
        account.identity,
        request.address,
        account.challenges,
        request.id,
      );
      request.status = "prepared";
      await saveRecovery(state); // Exact signed bytes survive a timeout or process restart.
    }
    if (!request.transaction)
      throw new Error("Recovery journal is missing its transaction.");
    const result = await executeEarningsRecovery(request.transaction);
    request.digest = result.digest;
    if (!result.success) {
      request.status = "failed";
      await saveRecovery(state);
      throw new Error(
        "Sui rejected the recovery; no royalty changes were made. Start a new request.",
      );
    }
    account.address = request.address;
    if (!account.aliases.includes(request.address))
      account.aliases.push(request.address);
    request.status = "complete";
    await saveRecovery(state);
    return {
      ok: true,
      kind: request.kind,
      digest: result.digest,
      address: request.address,
    };
  });
}
