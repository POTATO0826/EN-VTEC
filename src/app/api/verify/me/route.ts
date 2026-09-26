import { findTrack } from "@/lib/catalog";
import { load } from "@/lib/server/store";
import { kick, POOL_SIZE, QUORUM, revealOpen } from "@/lib/server/verification";

// Everything the Verify page needs for one session.
export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("session");
  if (!sessionId) return Response.json({ error: "missing_session" }, { status: 400 });

  kick().catch((e) => console.warn("[verify] kick failed:", e));
  const data = await load();
  const verifier = data.verifiers.find((v) => v.sessionId === sessionId) ?? null;

  const assignments = data.assignments
    .filter((a) => a.sessionId === sessionId)
    .map((a) => {
      const sub = data.submissions.find((s) => s.id === a.submissionId)!;
      const peers = data.assignments.filter((x) => x.submissionId === a.submissionId);
      return {
        id: a.id,
        status: a.status,
        report: a.report,
        submission: {
          id: sub.id,
          track: findTrack(sub.trackId)?.name ?? sub.trackId,
          trackId: sub.trackId,
          buildName: sub.buildName,
          buildSha256: sub.buildSha256,
          gpu: sub.gpu,
          status: sub.status,
          speedup: sub.speedup,
        },
        progress: {
          committed: peers.filter((p) => p.status === "committed" || p.status === "revealed").length,
          revealed: peers.filter((p) => p.status === "revealed").length,
          total: peers.length,
          revealOpen: revealOpen(peers.map((p) => p.status)),
        },
      };
    })
    .reverse();

  return Response.json({
    poolSize: data.verifiers.length,
    config: { poolSize: POOL_SIZE, quorum: QUORUM },
    verifier: verifier ? { reputation: verifier.reputation, joinedAt: verifier.joinedAt } : null,
    assignments,
  });
}
