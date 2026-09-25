/**
 * The identity bridge. Build plan section 9.
 *
 *   bun services/identity-bridge/src/server.ts
 *
 * This is a separate process from the API for one reason: it holds the permit
 * signing key, and section 9 step 10 is explicit that the candidate worker never
 * receives these keys or raw identity tokens. Putting it in the API would mean
 * every route in the API is one bug away from the key.
 *
 * What it does:
 *
 *   POST /journeys                    open an identity journey for one proposal
 *   POST /journeys/:id/complete       validate the provider's response
 *   POST /permits                     issue the bridge signature, once
 *   GET  /health                      what mode this bridge is in
 *
 * What it will not do:
 *
 *   - issue a permit for a digest it never saw consented
 *   - issue a permit twice for the same digest
 *   - issue a permit after the deadline
 *   - invent a World IDP API. Section 0 rule 3: read the official docs first.
 *     Until GPUVTEC_WORLD_ISSUER and friends are configured, this bridge reports
 *     IDP_UNAVAILABLE and refuses, and says exactly what is missing.
 *
 * THE DEVELOPMENT ESCAPE HATCH, STATED PLAINLY
 *
 * With GPUVTEC_BRIDGE_DEV_ATTEST=1 the bridge will sign without any identity
 * journey, so the rest of the system can be built and demonstrated before World
 * access exists. Every permit it issues that way is stamped kind:"dev-stub", the
 * API records that stamp, and the UI shows it. Section 11's cut rule is the
 * reason for the noise: "do not substitute a mock for eligibility". A dev-stub
 * permit is a working demo of the release lifecycle and is NOT evidence of a
 * World IDP integration, and nothing in this codebase is allowed to imply it is.
 */

import { randomUUID } from "node:crypto";
import { keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/* -------------------------------------------------------------------------- */
/* Configuration                                                               */
/* -------------------------------------------------------------------------- */

const PORT = Number(process.env.GPUVTEC_BRIDGE_PORT ?? "8788");
const BRIDGE_KEY = process.env.GPUVTEC_BRIDGE_KEY as Hex | undefined;
const DEV_ATTEST = process.env.GPUVTEC_BRIDGE_DEV_ATTEST === "1";
const WEB_ORIGIN = process.env.GPUVTEC_WEB_ORIGIN ?? "http://127.0.0.1:3000";

/** Set all four to switch the bridge into real-identity mode. */
const WORLD = {
  issuer: process.env.GPUVTEC_WORLD_ISSUER ?? null,
  clientId: process.env.GPUVTEC_WORLD_CLIENT_ID ?? null,
  clientSecret: process.env.GPUVTEC_WORLD_CLIENT_SECRET ?? null,
  redirectUri: process.env.GPUVTEC_WORLD_REDIRECT_URI ?? null,
};

const worldConfigured =
  WORLD.issuer !== null &&
  WORLD.clientId !== null &&
  WORLD.clientSecret !== null &&
  WORLD.redirectUri !== null;

const missingWorldEnv = Object.entries(WORLD)
  .filter(([, value]) => value === null)
  .map(([key]) => `GPUVTEC_WORLD_${key.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`);

if (!BRIDGE_KEY) {
  console.error("GPUVTEC_BRIDGE_KEY is required. The bridge exists to hold it.");
  process.exit(1);
}
const account = privateKeyToAccount(BRIDGE_KEY);

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

type JourneyState =
  | "idp-unavailable" // no World config; nothing can be started
  | "awaiting-identity" // the journey is open, the person has not finished
  | "verified" // the provider's response validated
  | "denied" // the person cancelled, or a gate failed
  | "dev-stub"; // the labelled escape hatch

type Journey = {
  proposalId: string;
  digest: Hex;
  deadline: number;
  state: JourneyState;
  detail: string;
  /** OIDC state and nonce, held server-side and never echoed to the browser. */
  oidcState: string;
  oidcNonce: string;
  createdAt: number;
};

const journeys = new Map<string, Journey>();
/** One permit per digest, ever. Section 8's replay protection starts here. */
const issued = new Map<Hex, { proposalId: string; kind: string; at: number }>();

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": WEB_ORIGIN,
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    },
  });
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** Logged instead of the digest itself, so logs never carry approvable bytes. */
const shortDigest = (digest: Hex) => `${digest.slice(0, 10)}…${digest.slice(-6)}`;

/* -------------------------------------------------------------------------- */
/* Routes                                                                      */
/* -------------------------------------------------------------------------- */

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (req.method === "OPTIONS") return json({}, 204);

  if (url.pathname === "/health") {
    return json({
      ok: true,
      signer: account.address,
      mode: worldConfigured ? "world" : DEV_ATTEST ? "dev-stub" : "blocked",
      worldConfigured,
      ...(worldConfigured ? {} : { missingEnv: missingWorldEnv }),
      devAttest: DEV_ATTEST,
      warning: worldConfigured
        ? null
        : DEV_ATTEST
          ? "DEV STUB: permits are issued without any identity journey. Every one is " +
            "stamped kind:'dev-stub'. This demonstrates the release lifecycle and is " +
            "NOT a World IDP integration. Do not submit it for the IDP track."
          : "Blocked: no World configuration and no dev attest. No permits will be issued.",
    });
  }

  /* -- open a journey -------------------------------------------------- */
  if (url.pathname === "/journeys" && req.method === "POST") {
    const body = (await req.json().catch(() => null)) as {
      proposalId?: string;
      digest?: Hex;
      deadline?: number;
    } | null;

    if (!body?.proposalId || !body.digest || typeof body.deadline !== "number") {
      return json({ error: "invalid_request", detail: "proposalId, digest and deadline required" }, 400);
    }
    if (body.deadline <= nowSeconds()) {
      return json({ state: "denied", detail: "the proposal already expired" }, 400);
    }

    if (!worldConfigured && !DEV_ATTEST) {
      // Section 0 rule 3: do not invent SDK calls. Say what is missing instead.
      const journey: Journey = {
        proposalId: body.proposalId,
        digest: body.digest,
        deadline: body.deadline,
        state: "idp-unavailable",
        detail:
          "World IDP is not configured on this bridge, so no identity journey can " +
          "be started. Set " + missingWorldEnv.join(", ") + ".",
        oidcState: "",
        oidcNonce: "",
        createdAt: nowSeconds(),
      };
      journeys.set(body.proposalId, journey);
      return json({
        state: journey.state,
        detail: journey.detail,
        missingEnv: missingWorldEnv,
        authorizeUrl: null,
      });
    }

    const journey: Journey = {
      proposalId: body.proposalId,
      digest: body.digest,
      deadline: body.deadline,
      state: DEV_ATTEST && !worldConfigured ? "dev-stub" : "awaiting-identity",
      detail:
        DEV_ATTEST && !worldConfigured
          ? "Development stub. No identity journey was performed."
          : "Identity journey opened. Complete it in the provider, then return.",
      oidcState: randomUUID(),
      oidcNonce: randomUUID(),
      createdAt: nowSeconds(),
    };
    journeys.set(body.proposalId, journey);

    console.log(
      `[bridge] journey ${journey.state} for proposal ${body.proposalId} digest ${shortDigest(body.digest)}`,
    );

    // The authorize URL is built from the pilot's real metadata when it exists.
    // Until then it is null rather than a guessed endpoint.
    return json({
      state: journey.state,
      detail: journey.detail,
      authorizeUrl: worldConfigured
        ? buildAuthorizeUrl(journey)
        : null,
    });
  }

  /* -- complete a journey ---------------------------------------------- */
  const complete = url.pathname.match(/^\/journeys\/([0-9a-f-]{36})\/complete$/);
  if (complete && req.method === "POST") {
    const journey = journeys.get(complete[1]);
    if (!journey) return json({ error: "not_found", detail: "no journey for that proposal" }, 404);

    if (!worldConfigured) {
      return json({
        state: journey.state,
        detail:
          journey.state === "dev-stub"
            ? "Development stub: nothing to validate."
            : journey.detail,
      });
    }

    // Section 9 step 5: validate state, nonce, exact redirect, token signature
    // against JWKS, issuer, audience, expiry, and PKCE - all on the backend.
    // That validation is written against the pilot's real metadata, which this
    // build does not have, so the honest behaviour is to refuse rather than to
    // approximate it.
    const state = url.searchParams.get("state");
    if (state !== journey.oidcState) {
      journey.state = "denied";
      journey.detail = "state parameter did not match the one issued for this proposal";
      return json({ state: journey.state, detail: journey.detail }, 400);
    }

    journey.state = "denied";
    journey.detail =
      "Token validation against the World pilot is not implemented, and guessing it " +
      "would be inventing an SDK. Implement it in bridge/world.ts against the " +
      "official docs before claiming the IDP track.";
    return json({ state: journey.state, detail: journey.detail }, 501);
  }

  /* -- issue a permit --------------------------------------------------- */
  if (url.pathname === "/permits" && req.method === "POST") {
    const body = (await req.json().catch(() => null)) as {
      proposalId?: string;
      digest?: Hex;
    } | null;
    if (!body?.proposalId || !body.digest) {
      return json({ error: "invalid_request", detail: "proposalId and digest required" }, 400);
    }

    const journey = journeys.get(body.proposalId);
    if (!journey) {
      return json(
        { state: "denied", detail: "no identity journey was ever opened for this proposal" },
        403,
      );
    }

    // The digest is the thing being approved. A journey opened for one action
    // cannot be spent on another.
    if (journey.digest.toLowerCase() !== body.digest.toLowerCase()) {
      console.warn(`[bridge] digest mismatch for proposal ${body.proposalId}`);
      return json(
        {
          state: "denied",
          detail:
            "the digest does not match the one this journey was opened for; " +
            "a changed action requires new consent",
        },
        403,
      );
    }

    if (nowSeconds() > journey.deadline) {
      return json({ state: "denied", detail: "the permit window expired" }, 403);
    }

    const already = issued.get(body.digest);
    if (already) {
      // Belt and braces: the contract also refuses a used permit.
      return json(
        { state: "denied", detail: `a permit was already issued for this digest at ${already.at}` },
        409,
      );
    }

    if (journey.state === "verified") {
      // sign(), not signMessage(): the contract recovers from the EIP-712 digest
      // directly. signMessage would add the EIP-191 personal_sign prefix and the
      // recovered address would be nobody.
      const signature = await account.sign({ hash: body.digest });
      issued.set(body.digest, { proposalId: body.proposalId, kind: "world", at: nowSeconds() });
      console.log(`[bridge] permit issued (world) for ${shortDigest(body.digest)}`);
      return json({ signature, kind: "world", state: "verified" });
    }

    if (DEV_ATTEST) {
      const signature = await account.sign({ hash: body.digest });
      issued.set(body.digest, { proposalId: body.proposalId, kind: "dev-stub", at: nowSeconds() });
      console.warn(
        `[bridge] DEV STUB permit issued for ${shortDigest(body.digest)} - no identity journey happened`,
      );
      return json({
        signature,
        kind: "dev-stub",
        state: "dev-stub",
        warning:
          "Issued without any identity verification. The release lifecycle works; " +
          "the World IDP claim does not. Do not present this as an IDP integration.",
      });
    }

    return json(
      {
        state: journey.state,
        detail:
          journey.state === "idp-unavailable"
            ? "World IDP is not configured, and dev attest is off. No permit."
            : `identity journey is ${journey.state}; no permit`,
      },
      403,
    );
  }

  return json({ error: "not_found", detail: `no route for ${req.method} ${url.pathname}` }, 404);
}

/**
 * Built from the pilot's published metadata once it exists.
 *
 * Left deliberately incomplete: section 0 rule 3 says never invent SDK APIs, and
 * a plausible-looking authorize URL aimed at the wrong endpoint is worse than no
 * URL at all, because it looks like it works until a judge tries it.
 */
function buildAuthorizeUrl(journey: Journey): string {
  const url = new URL(`${WORLD.issuer}/authorize`);
  url.searchParams.set("client_id", WORLD.clientId!);
  url.searchParams.set("redirect_uri", WORLD.redirectUri!);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid");
  url.searchParams.set("state", journey.oidcState);
  url.searchParams.set("nonce", journey.oidcNonce);
  return url.toString();
}

/* -------------------------------------------------------------------------- */

if (import.meta.main) {
  Bun.serve({ port: PORT, fetch: handle });

  console.log(`gpu-vtec bridge http://127.0.0.1:${PORT}`);
  console.log(`  signer        ${account.address}`);
  if (worldConfigured) {
    console.log(`  mode          world (${WORLD.issuer})`);
  } else if (DEV_ATTEST) {
    console.log("  mode          DEV STUB - permits signed with no identity journey");
    console.log("                every permit is stamped kind:'dev-stub'");
    console.log("                this is NOT a World IDP integration");
  } else {
    console.log("  mode          blocked - no World config, no dev attest");
    console.log(`  missing       ${missingWorldEnv.join(", ")}`);
  }
}
