import { signRequest } from "@worldcoin/idkit-core/signing";
import { idkit, missingIdkitEnv } from "@/lib/server/world";

// Signs the IDKit request so World App knows it comes from us.
// The browser gets the signature, never the key.
export async function POST() {
  const missing = missingIdkitEnv();
  if (missing.length > 0) {
    return Response.json({ error: "world_not_configured", missing }, { status: 503 });
  }

  const { sig, nonce, createdAt, expiresAt } = signRequest({
    signingKeyHex: idkit.signingKey,
    action: idkit.action,
  });

  return Response.json({
    app_id: idkit.appId,
    action: idkit.action,
    environment: idkit.environment,
    rp_context: {
      rp_id: idkit.rpId,
      nonce,
      created_at: createdAt,
      expires_at: expiresAt,
      signature: sig,
    },
  });
}
