import { findTrack } from "@/lib/catalog";
import { load, update } from "@/lib/server/store";
import { missingIdkitEnv, signedRequest } from "@/lib/server/world";

// Permission for one agent submission: first a World ID approval (a real
// person says yes to this one submission), then the 0.5 SUI process fee.
export async function POST(request: Request) {
  const missing = missingIdkitEnv();
  if (missing.length > 0) {
    return Response.json({ error: "world_not_configured", missing }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as {
    sessionId?: string;
    trackId?: string;
  } | null;
  const track = body?.trackId ? findTrack(body.trackId) : null;
  if (!body?.sessionId || !track) {
    return Response.json({ error: "missing_fields" }, { status: 400 });
  }

  const data = await load();
  if (!data.seats.some((s) => s.sessionId === body.sessionId)) {
    return Response.json({ error: "no_seat" }, { status: 403 });
  }

  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const action = `vtec-submit:${track.id}:${id}`;
  await update((d) => {
    d.approvals.push({
      id,
      sessionId: body.sessionId!,
      trackId: track.id,
      kind: "worldid",
      action,
      status: "pending",
      nullifier: null,
      stake: null,
      fee: null,
      at: new Date().toISOString(),
    });
  });

  return Response.json({
    approvalId: id,
    ...signedRequest(action, `Let my VTEC agent submit one build to ${track.name}`),
  });
}
