import { findTrack } from "@/lib/catalog";
import { load, update } from "@/lib/server/store";

// Permission for one agent submission by a World ID-verified tuner. No second
// World ID check here: the seat proved the person at Get started (and minted
// their HumanPass), so the approval is backed by that seat and paying the
// process fee in Slush is the consent. It works once, for this track only.
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
  const seat = data.seats.find((s) => s.sessionId === body.sessionId);
  if (!seat) return Response.json({ error: "no_seat" }, { status: 403 });

  // Reuse an unpaid approval rather than piling up new ones on every click.
  const used = new Set(data.submissions.map((s) => s.approvalId));
  const open = data.approvals.find(
    (a) => a.sessionId === body.sessionId && a.trackId === track.id && a.kind === "worldid" && !a.fee && !used.has(a.id),
  );
  if (open) return Response.json({ approvalId: open.id });

  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  await update((d) => {
    d.approvals.push({
      id,
      sessionId: body.sessionId!,
      trackId: track.id,
      kind: "worldid",
      action: "",
      status: "approved",
      nullifier: seat.nullifier,
      fee: null,
      at: new Date().toISOString(),
    });
  });
  return Response.json({ approvalId: id });
}
