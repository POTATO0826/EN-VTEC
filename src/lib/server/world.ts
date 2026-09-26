import "server-only";
import { createRemoteJWKSet, jwtVerify } from "jose";

/* ---------------------------------------------------------------------------
 * World IDKit (Proof of Human, one seat per person)
 * ------------------------------------------------------------------------- */

export const idkit = {
  appId: process.env.NEXT_PUBLIC_WLD_APP_ID ?? "",
  rpId: process.env.WLD_RP_ID ?? "",
  signingKey: process.env.RP_SIGNING_KEY ?? "",
  action: process.env.NEXT_PUBLIC_WLD_ACTION ?? "claim-tuner-seat",
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

/* ---------------------------------------------------------------------------
 * World ID for Agents (OIDC device flow)
 *
 * The local agent can't be trusted to act alone, so every submission needs a
 * human to approve it in World App. The device flow fits that exactly: we get a
 * short code, the human approves it on their phone, and we poll for the token.
 * No redirect URL, so it works from localhost too.
 * ------------------------------------------------------------------------- */

export const agents = {
  issuer: process.env.WA_ISSUER ?? "https://sandbox.auth.world.org",
  clientId: process.env.WA_CLIENT_ID ?? "",
  clientSecret: process.env.WA_CLIENT_SECRET ?? "",
};

export function missingAgentsEnv(): string[] {
  const missing: string[] = [];
  if (!agents.clientId) missing.push("WA_CLIENT_ID");
  if (!agents.clientSecret) missing.push("WA_CLIENT_SECRET");
  return missing;
}

type Discovery = {
  issuer: string;
  device_authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
};

let discovery: Promise<Discovery> | null = null;
function discover() {
  discovery ??= fetch(`${agents.issuer}/.well-known/openid-configuration`).then(
    async (res) => {
      if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`);
      return (await res.json()) as Discovery;
    },
  );
  return discovery;
}

function basicAuth() {
  return "Basic " + Buffer.from(`${agents.clientId}:${agents.clientSecret}`).toString("base64");
}

export async function startDeviceFlow() {
  const meta = await discover();
  const res = await fetch(meta.device_authorization_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuth(),
    },
    body: new URLSearchParams({ client_id: agents.clientId, scope: "openid" }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error_description ?? body.error ?? `device_authorization ${res.status}`);
  }
  return body as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete?: string;
    expires_in: number;
    interval?: number;
  };
}

export type PollResult =
  | { status: "pending" }
  | { status: "slow_down" }
  | { status: "denied" | "expired"; detail: string }
  | { status: "approved"; sub: string };

export async function pollDeviceFlow(deviceCode: string): Promise<PollResult> {
  const meta = await discover();
  const res = await fetch(meta.token_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuth(),
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: deviceCode,
      client_id: agents.clientId,
    }),
  });
  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    switch (body.error) {
      case "authorization_pending":
        return { status: "pending" };
      case "slow_down":
        return { status: "slow_down" };
      case "access_denied":
        return { status: "denied", detail: "The request was declined in World App." };
      case "expired_token":
        return { status: "expired", detail: "The code expired before it was approved." };
      default:
        return { status: "denied", detail: body.error_description ?? body.error ?? `token ${res.status}` };
    }
  }

  // Never trust the token just because it came back: check signature, issuer,
  // audience and expiry against the issuer's published keys.
  const jwks = createRemoteJWKSet(new URL(meta.jwks_uri));
  const { payload } = await jwtVerify(body.id_token as string, jwks, {
    issuer: meta.issuer,
    audience: agents.clientId,
  });
  if (!payload.sub) return { status: "denied", detail: "Token had no subject." };
  return { status: "approved", sub: payload.sub };
}
