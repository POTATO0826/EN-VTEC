import { findTrack } from "@/lib/catalog";
import { load } from "@/lib/server/store";

// Leaderboard for one track: best result per seat, fastest first.
export async function GET(request: Request, ctx: RouteContext<"/api/tracks/[id]">) {
  const { id } = await ctx.params;
  if (!findTrack(id)) return Response.json({ error: "unknown_track" }, { status: 404 });

  const sessionId = new URL(request.url).searchParams.get("session");
  const data = await load();

  const best = new Map<string, (typeof data.submissions)[number]>();
  for (const s of data.submissions.filter((x) => x.trackId === id)) {
    const current = best.get(s.sessionId);
    if (!current || s.seconds < current.seconds) best.set(s.sessionId, s);
  }
  const rows = [...best.values()]
    .sort((a, b) => a.seconds - b.seconds)
    .map((s, index) => ({
      rank: index + 1,
      mine: s.sessionId === sessionId,
      gpu: s.gpu,
      seconds: s.seconds,
      buildSha256: s.buildSha256,
      resultSha256: s.resultSha256,
      at: s.at,
    }));

  // Approvals for this session that haven't been spent on a submission yet.
  const used = new Set(data.submissions.map((s) => s.approvalId));
  const openApproval = sessionId
    ? data.approvals.some(
        (a) => a.sessionId === sessionId && a.trackId === id && a.status === "approved" && !used.has(a.id),
      )
    : false;

  return Response.json({ rows, openApproval });
}
