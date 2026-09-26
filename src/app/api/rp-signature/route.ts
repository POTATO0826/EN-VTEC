import { signRequest } from "@worldcoin/idkit-core/signing";
import { missingWorldEnv, world } from "@/lib/world-server";

// Signs the IDKit request so World App knows it really comes from our RP.
// The browser gets the signature, never the key.
export async function POST() {
  const missing = missingWorldEnv();
  if (missing.length > 0) {
    return Response.json(
      { error: "world_not_configured", missing },
      { status: 503 },
    );
  }

  const { sig, nonce, createdAt, expiresAt } = signRequest({
    signingKeyHex: world.signingKey,
    action: world.action,
  });

  return Response.json({
    app_id: world.appId,
    action: world.action,
    environment: world.environment,
    rp_context: {
      rp_id: world.rpId,
      nonce,
      created_at: createdAt,
      expires_at: expiresAt,
      signature: sig,
    },
  });
}
