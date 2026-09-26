import { load } from "@/lib/server/store";
import { revealOpen } from "@/lib/server/verification";

// Verification jobs for the agent's session: approved ones to run, committed
// ones waiting to reveal.
export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code")?.toUpperCase();
  const data = await load();
  const agent = data.agents.find((a) => a.code === code && a.sessionId);
  if (!agent?.sessionId) return Response.json({ error: "unknown_code" }, { status: 404 });

  const jobs = data.assignments
    .filter((a) => a.sessionId === agent.sessionId && (a.status === "approved" || a.status === "committed"))
    .map((a) => {
      const sub = data.submissions.find((s) => s.id === a.submissionId)!;
      const peers = data.assignments.filter((x) => x.submissionId === a.submissionId);
      return {
        assignmentId: a.id,
        status: a.status,
        revealOpen: revealOpen(peers.map((p) => p.status)),
        submission: {
          id: sub.id,
          trackId: sub.trackId,
          buildName: sub.buildName,
          buildSha256: sub.buildSha256,
          resultSha256: sub.resultSha256,
          requires: sub.requires,
          claim: sub.claim ?? null,
        },
      };
    });

  const pendingApproval = data.assignments.filter(
    (a) => a.sessionId === agent.sessionId && a.status === "assigned",
  ).length;
  return Response.json({ jobs, pendingApproval });
}
