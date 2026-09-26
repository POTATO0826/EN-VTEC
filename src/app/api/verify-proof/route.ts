import type { IDKitResult } from "@worldcoin/idkit";
import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { findSeat, missingWorldEnv, saveSeat, world } from "@/lib/world-server";

// Checks the proof with the Developer Portal, then claims the seat. Nothing the
// client says about the proof is trusted: only the portal's answer counts.
export async function POST(request: Request) {
  const missing = missingWorldEnv();
  if (missing.length > 0) {
    return Response.json(
      { error: "world_not_configured", missing },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    idkitResponse?: IDKitResult;
    wallet?: string | null;
  } | null;
  if (!body?.idkitResponse) {
    return Response.json({ error: "missing_proof" }, { status: 400 });
  }

  // The widget uses the wallet address as the signal, so the proof is bound to
  // that wallet. Check it here, or someone could replay a proof for another one.
  const wallet = body.wallet?.toLowerCase() ?? null;
  const expectedSignal = hashSignal(wallet ?? "");
  const responses = "responses" in body.idkitResponse ? body.idkitResponse.responses : [];
  const bound = responses.every(
    (item) => !("signal_hash" in item) || item.signal_hash === expectedSignal,
  );
  if (!bound) {
    return Response.json({ error: "signal_mismatch" }, { status: 400 });
  }

  const res = await fetch(
    `https://developer.world.org/api/v4/verify/${world.rpId}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body.idkitResponse),
    },
  );
  const verdict = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    nullifier?: string;
    action?: string;
    code?: string;
    detail?: string;
  };

  if (!res.ok || !verdict.success || !verdict.nullifier) {
    return Response.json(
      {
        error: "verification_failed",
        code: verdict.code ?? `http_${res.status}`,
        detail: verdict.detail ?? null,
      },
      { status: 400 },
    );
  }
  if (verdict.action && verdict.action !== world.action) {
    return Response.json({ error: "wrong_action" }, { status: 400 });
  }

  const existing = await findSeat(verdict.nullifier);
  if (existing) {
    return Response.json(
      {
        error: "seat_taken",
        detail: "This World ID already claimed a tuner seat.",
        wallet: existing.wallet,
      },
      { status: 409 },
    );
  }

  await saveSeat({
    nullifier: verdict.nullifier,
    wallet,
    at: new Date().toISOString(),
  });

  return Response.json({ ok: true, nullifier: verdict.nullifier });
}
