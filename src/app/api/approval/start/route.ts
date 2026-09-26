import { findTrack } from "@/lib/catalog";
import { load, update } from "@/lib/server/store";
import { missingSuiEnv, sui } from "@/lib/server/sui";
import { missingIdkitEnv, signedRequest } from "@/lib/server/world";

// Permission for one agent submission. World ID verified users approve it with
// World ID (free). Everyone else stakes SUI against it instead.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    sessionId?: string;
    trackId?: string;
  } | null;
  const track = body?.trackId ? findTrack(body.trackId) : null;
  if (!body?.sessionId || !track) {
    return Response.json({ error: "missing_fields" }, { status: 400 });
  }

  const data = await load();
  const verified = data.seats.some((s) => s.sessionId === body.sessionId);
  const kind = verified ? "worldid" : "stake";

  const missing = verified ? missingIdkitEnv() : missingSuiEnv();
  if (missing.length > 0) {
    return Response.json(
      { error: verified ? "world_not_configured" : "sui_not_configured", missing },
      { status: 503 },
    );
  }

  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const action = `vtec-submit:${track.id}:${id}`;
  await update((d) => {
    d.approvals.push({
      id,
      sessionId: body.sessionId!,
      trackId: track.id,
      kind,
      action,
      status: "pending",
      nullifier: null,
      stake: null,
      at: new Date().toISOString(),
    });
  });

  if (kind === "stake") {
    return Response.json({
      approvalId: id,
      kind,
      stakeMist: sui.stakeMist.toString(),
      packageId: sui.packageId,
      vaultId: sui.vaultId,
    });
  }
  return Response.json({
    approvalId: id,
    kind,
    ...signedRequest(action, `Let my VTEC agent submit one build to ${track.name}`),
  });
}
