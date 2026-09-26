import type { IDKitResult } from "@worldcoin/idkit";
import { update } from "@/lib/server/store";
import { idkit, missingIdkitEnv, verifyProof } from "@/lib/server/world";

// Verifies the World ID proof, then gives this session a tuner seat.
// The session id is the signal, so a proof made for one session can't be
// replayed to claim a seat for another.
export async function POST(request: Request) {
  const missing = missingIdkitEnv();
  if (missing.length > 0) {
    return Response.json({ error: "world_not_configured", missing }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as {
    sessionId?: string;
    idkitResponse?: IDKitResult;
  } | null;
  if (!body?.sessionId || !body.idkitResponse) {
    return Response.json({ error: "missing_fields" }, { status: 400 });
  }

  const verdict = await verifyProof(body.idkitResponse, idkit.seatAction, body.sessionId);
  if (!verdict.ok) {
    return Response.json(
      { error: verdict.error, code: verdict.code, detail: verdict.detail },
      { status: verdict.status },
    );
  }

  const { nullifier } = verdict;
  const sessionId = body.sessionId;
  const result = await update((data) => {
    const existing = data.seats.find((s) => s.nullifier === nullifier);
    if (existing && existing.sessionId !== sessionId) return "taken" as const;
    if (!existing) data.seats.push({ nullifier, sessionId, at: new Date().toISOString() });
    return "ok" as const;
  });

  if (result === "taken") {
    return Response.json(
      { error: "seat_taken", detail: "This World ID already holds a tuner seat." },
      { status: 409 },
    );
  }
  return Response.json({ ok: true, nullifier });
}
