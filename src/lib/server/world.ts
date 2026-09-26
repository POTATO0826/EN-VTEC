import "server-only";
import type { IDKitResult } from "@worldcoin/idkit";
import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { signRequest } from "@worldcoin/idkit-core/signing";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

/** Why World refused a proof, kept in .data/world.log for debugging. */
export function logWorld(where: string, detail: unknown) {
  try {
    mkdirSync(path.join(process.cwd(), ".data"), { recursive: true });
    appendFileSync(
      path.join(process.cwd(), ".data", "world.log"),
      `${new Date().toISOString()} ${where} ${JSON.stringify(detail)}
`,
    );
  } catch {
    /* logging must never break verification */
  }
}

/**
 * World ID via IDKit, used for two things:
 *  - claiming a seat + HumanPass (one per human, ever), action `vtec-humanpass`
 *  - approving each agent submission (human in the loop), action
 *    `vtec-submit:<track>:<approval id>`, so every proof is bound to exactly
 *    one submission and can't be reused for another.
 */

export const idkit = {
  appId: process.env.NEXT_PUBLIC_WLD_APP_ID ?? "",
  rpId: process.env.WLD_RP_ID ?? "",
  signingKey: process.env.RP_SIGNING_KEY ?? "",
  // One proof per person, ever, per action (World ID 4.0 refuses a second one
  // with "nullifier_replayed"). The HumanPass step has its own action so it
  // doesn't collide with seats claimed before HumanPass existed.
  seatAction: process.env.WLD_PASS_ACTION ?? "vtec-humanpass",
  // "staging" works with the World ID simulator instead of a real Orb.
  environment: (process.env.WLD_ENVIRONMENT ?? "staging") as "production" | "staging",
  // Staging proofs are only accepted while a 24h staging window is open for the
  // app, and must carry the token that window issued.
  stagingToken: process.env.WLD_STAGING_TOKEN ?? "",
};

export function missingIdkitEnv(): string[] {
  const missing: string[] = [];
  if (!idkit.appId.startsWith("app_")) missing.push("NEXT_PUBLIC_WLD_APP_ID (app_…)");
  if (!idkit.rpId.startsWith("rp_")) missing.push("WLD_RP_ID (rp_…)");
  if (!idkit.signingKey) missing.push("RP_SIGNING_KEY");
  return missing;
}

/** What the browser needs to open the IDKit widget for one action. */
export function signedRequest(action: string, actionDescription?: string) {
  const { sig, nonce, createdAt, expiresAt } = signRequest({
    signingKeyHex: idkit.signingKey,
    action,
  });
  return {
    app_id: idkit.appId,
    action,
    action_description: actionDescription,
    environment: idkit.environment,
    rp_context: {
      rp_id: idkit.rpId,
      nonce,
      created_at: createdAt,
      expires_at: expiresAt,
      signature: sig,
    },
  };
}

export type Verdict =
  | { ok: true; nullifier: string }
  | { ok: false; status: number; error: string; code?: string; detail?: string };

/**
 * Checks a proof end to end: it must be for `action`, its signal must be
 * `signal`, and World's Developer Portal must accept it. Only the portal's
 * answer is trusted, never anything the client claims.
 */
export async function verifyProof(
  proof: IDKitResult,
  action: string,
  signal: string,
): Promise<Verdict> {
  if (!("action" in proof) || proof.action !== action) {
    return { ok: false, status: 400, error: "wrong_action" };
  }

  const expected = hashSignal(signal);
  const responses = "responses" in proof ? proof.responses : [];
  const bound = responses.every((item) => !("signal_hash" in item) || item.signal_hash === expected);
  if (!bound) return { ok: false, status: 400, error: "signal_mismatch" };

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (idkit.environment !== "production" && idkit.stagingToken) {
    headers["x-staging-verification-token"] = idkit.stagingToken;
  }
  const res = await fetch(`https://developer.world.org/api/v4/verify/${idkit.rpId}`, {
    method: "POST",
    headers,
    // Pin the environment we run in, so a client can't slip a test proof into
    // a production deployment.
    body: JSON.stringify({ ...proof, environment: idkit.environment }),
    signal: AbortSignal.timeout(10_000),
  });
  const verdict = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    nullifier?: string;
    action?: string;
    code?: string;
    detail?: string;
  };

  if (!res.ok || !verdict.success || !verdict.nullifier) {
    return {
      ok: false,
      status: 400,
      error: "verification_failed",
      code: verdict.code ?? `http_${res.status}`,
      detail: verdict.detail,
    };
  }
  if (verdict.action && verdict.action !== action) {
    return { ok: false, status: 400, error: "wrong_action" };
  }
  // Same number can arrive as 0x01 or 0x1; normalise before using it as a key.
  return { ok: true, nullifier: "0x" + BigInt(verdict.nullifier).toString(16) };
}
