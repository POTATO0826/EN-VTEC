import { findTrack } from "@/lib/catalog";
import { load, update } from "@/lib/server/store";
import { adminAddress, adminReady, sui } from "@/lib/server/sui";

// Publishing without World ID: instead of a World ID approval and the process
// fee, the tuner stakes SUI to the platform wallet. It comes back if the kernel
// verifies (correct, and at least 0.1% faster); otherwise it's slashed.
// One open stake approval per session and track, reused until it's spent.
export async function POST(request: Request) {
  if (!adminReady()) {
    return Response.json({ error: "sui_not_configured", detail: "The platform wallet isn't set up." }, { status: 503 });
  }
  const body = (await request.json().catch(() => null)) as { sessionId?: string; trackId?: string } | null;
  const track = body?.trackId ? findTrack(body.trackId) : null;
  if (!body?.sessionId || !track) return Response.json({ error: "missing_fields" }, { status: 400 });

  const data = await load();
  const used = new Set(data.submissions.map((s) => s.approvalId));
  const open = data.approvals.find(
    (a) => a.sessionId === body.sessionId && a.trackId === track.id && a.kind === "stake" && !used.has(a.id),
  );
  const id = open?.id ?? crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  if (!open) {
    await update((d) => {
      d.approvals.push({
        id,
        sessionId: body.sessionId!,
        trackId: track.id,
        kind: "stake",
        action: "",
        status: "pending",
        nullifier: null,
        fee: null,
        stake: null,
        at: new Date().toISOString(),
      });
    });
  }
  return Response.json({
    approvalId: id,
    staked: !!open?.stake,
    to: adminAddress(),
    amountMist: String(sui.stakeMist),
  });
}
