import { load, update } from "@/lib/server/store";

// Step one of commit–reveal: the verifier locks in a hash of their report
// before anyone's results are visible, so nobody can copy a peer.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    code?: string;
    assignmentId?: string;
    commit?: string;
  } | null;
  if (!body?.code || !body.assignmentId || !/^[0-9a-f]{64}$/.test(body.commit ?? "")) {
    return Response.json({ error: "missing_fields" }, { status: 400 });
  }

  const data = await load();
  const agent = data.agents.find((a) => a.code === body.code!.toUpperCase() && a.sessionId);
  const assignment = data.assignments.find((a) => a.id === body.assignmentId && a.sessionId === agent?.sessionId);
  if (!assignment) return Response.json({ error: "unknown_assignment" }, { status: 404 });
  if (assignment.status !== "approved") {
    return Response.json(
      {
        error: "not_approved",
        detail: assignment.status === "assigned" ? "Approve this verification with World ID on the Verify page first." : "Already committed.",
      },
      { status: 409 },
    );
  }

  await update((d) => {
    const a = d.assignments.find((x) => x.id === assignment.id);
    if (a && a.status === "approved") {
      a.status = "committed";
      a.commit = body.commit!;
    }
  });
  return Response.json({ ok: true });
}
