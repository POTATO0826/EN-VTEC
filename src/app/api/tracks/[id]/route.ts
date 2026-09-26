import { findTrack } from "@/lib/catalog";
import { hasBuild, load } from "@/lib/server/store";
import { kick } from "@/lib/server/verification";

// Submissions for one track with their verification progress. Nothing here is
// a ranking: only verified entries count, and they live on /ranking.
export async function GET(request: Request, ctx: RouteContext<"/api/tracks/[id]">) {
  const { id } = await ctx.params;
  if (!findTrack(id)) return Response.json({ error: "unknown_track" }, { status: 404 });

  const sessionId = new URL(request.url).searchParams.get("session");
  kick().catch((e) => console.warn("[verify] kick failed:", e));
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
        // Made before builds were uploaded: nothing for verifiers to re-run.
        legacy: !hasBuild(s.buildSha256),
        harness: !!s.harness,
        verifiers: {
          assigned: peers.length,
          revealed: peers.filter((a) => a.status === "revealed").length,
          passed: peers.filter((a) => a.report?.pass).length,
        },
        at: s.at,
      };
    });

  // Where this session is in "approve with World ID -> pay the fee -> run".
  const used = new Set(data.submissions.map((s) => s.approvalId));
  const open = sessionId
    ? data.approvals.filter(
        (a) => a.sessionId === sessionId && a.trackId === id && a.status === "approved" && !used.has(a.id),
      )
    : [];
  const ready = open.find((a) => a.fee);
  const unpaid = open.find((a) => !a.fee && a.kind === "worldid");
  const verified = sessionId ? data.seats.some((s) => s.sessionId === sessionId) : false;

  return Response.json({
    rows,
    verified,
    approval: ready
      ? { id: ready.id, stage: "ready" as const }
      : unpaid
        ? { id: unpaid.id, stage: "needs_fee" as const }
        : null,
  });
}
