import type { IDKitResult } from "@worldcoin/idkit";
import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { update } from "@/lib/server/store";
import { idkit, missingIdkitEnv } from "@/lib/server/world";

// Verifies the World ID proof with the Developer Portal, then gives this
// session a tuner seat. Only the portal's answer is trusted, never the client.
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

  // The session id is the signal, so a proof made for one session can't be
  // replayed to claim a seat for another.
  const expected = hashSignal(body.sessionId);
  const responses = "responses" in body.idkitResponse ? body.idkitResponse.responses : [];
  const bound = responses.every(
    (item) => !("signal_hash" in item) || item.signal_hash === expected,
  );
  if (!bound) return Response.json({ error: "signal_mismatch" }, { status: 400 });

  const res = await fetch(`https://developer.world.org/api/v4/verify/${idkit.rpId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body.idkitResponse),
  });
  const verdict = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    nullifier?: string;
    action?: string;
    code?: string;
    detail?: string;
  };
  if (!res.ok || !verdict.success || !verdict.nullifier) {
    return Response.json(
      { error: "verification_failed", code: verdict.code ?? `http_${res.status}`, detail: verdict.detail ?? null },
      { status: 400 },
    );
  }
  if (verdict.action && verdict.action !== idkit.action) {
    return Response.json({ error: "wrong_action" }, { status: 400 });
  }

  const nullifier = verdict.nullifier;
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
