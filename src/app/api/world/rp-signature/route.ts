import { idkit, missingIdkitEnv, signedRequest } from "@/lib/server/world";

// Signed IDKit request for claiming a tuner seat. The browser gets the
// signature, never the key.
export async function POST() {
  const missing = missingIdkitEnv();
  if (missing.length > 0) {
    return Response.json({ error: "world_not_configured", missing }, { status: 503 });
  }
  return Response.json(signedRequest(idkit.seatAction));
}
