import { load, update, type VerifyReport } from "@/lib/server/store";
import { commitOf, revealOpen, tally } from "@/lib/server/verification";

// Step two of commit–reveal. Only opens once every assigned verifier has
// committed, and the report must hash to exactly what was committed.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    code?: string;
    assignmentId?: string;
    report?: VerifyReport;
    salt?: string;
  } | null;
  if (!body?.code || !body.assignmentId || !body.report || !body.salt) {
    return Response.json({ error: "missing_fields" }, { status: 400 });
  }

  const data = await load();
  const agent = data.agents.find((a) => a.code === body.code!.toUpperCase() && a.sessionId);
  const assignment = data.assignments.find((a) => a.id === body.assignmentId && a.sessionId === agent?.sessionId);
  if (!assignment) return Response.json({ error: "unknown_assignment" }, { status: 404 });
  if (assignment.status === "revealed") return Response.json({ ok: true });
  if (assignment.status !== "committed") return Response.json({ error: "not_committed" }, { status: 409 });

  const peers = data.assignments.filter((a) => a.submissionId === assignment.submissionId);
  if (!revealOpen(peers.map((p) => p.status))) {
    return Response.json({ error: "reveal_not_open", detail: "Waiting for the other verifiers to commit." }, { status: 425 });
  }
  if (commitOf(body.report, body.salt) !== assignment.commit) {
    return Response.json({ error: "commit_mismatch", detail: "Report doesn't match what was committed." }, { status: 400 });
  }

  await update((d) => {
    const a = d.assignments.find((x) => x.id === assignment.id);
    if (a && a.status === "committed") {
      a.status = "revealed";
      a.report = body.report!;
    }
  });
  await tally(assignment.submissionId, assignment.id);
  const sub = (await load()).submissions.find((s) => s.id === assignment.submissionId);
  return Response.json({ ok: true, submissionStatus: sub?.status });
}
