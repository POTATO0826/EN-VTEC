import { findTrack } from "@/lib/catalog";
import { load } from "@/lib/server/store";

// Submissions for one track with their verification progress. Nothing here is
// a ranking: only verified entries count, and they live on /ranking.
export async function GET(request: Request, ctx: RouteContext<"/api/tracks/[id]">) {
  const { id } = await ctx.params;
  if (!findTrack(id)) return Response.json({ error: "unknown_track" }, { status: 404 });

  const sessionId = new URL(request.url).searchParams.get("session");
  const data = await load();

  const rows = data.submissions
    .filter((s) => s.trackId === id)
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((s) => {
      const peers = data.assignments.filter((a) => a.submissionId === s.id);
      return {
        id: s.id,
        mine: s.sessionId === sessionId,
        status: s.status,
        buildName: s.buildName,
        buildSha256: s.buildSha256,
        gpu: s.gpu,
        seconds: s.seconds,
        speedup: s.speedup,
        verifiers: {
          assigned: peers.length,
          revealed: peers.filter((a) => a.status === "revealed").length,
          passed: peers.filter((a) => a.report?.pass).length,
        },
        at: s.at,
      };
    });

  const used = new Set(data.submissions.map((s) => s.approvalId));
  const openApproval = sessionId
    ? data.approvals.some(
        (a) => a.sessionId === sessionId && a.trackId === id && a.status === "approved" && !used.has(a.id),
      )
    : false;
  const verified = sessionId ? data.seats.some((s) => s.sessionId === sessionId) : false;

  return Response.json({ rows, openApproval, verified, payout: sessionId ? data.payouts[sessionId] ?? null : null });
}
