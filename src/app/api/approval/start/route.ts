import { findTrack } from "@/lib/catalog";
import { load, update } from "@/lib/server/store";
import { missingIdkitEnv, signedRequest } from "@/lib/server/world";

// Human in the loop: before the agent may submit, a verified human approves
// this one submission with World ID. The action names the track and a fresh
// approval id, so the proof can't be reused for any other submission.
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

  // Only seat holders can submit.
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
      action,
      status: "pending",
      nullifier: null,
      at: new Date().toISOString(),
    });
  });

  return Response.json({
    approvalId: id,
    ...signedRequest(action, `Let my VTEC agent submit one build to ${track.name}`),
  });
}
