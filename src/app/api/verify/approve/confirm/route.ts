import type { IDKitResult } from "@worldcoin/idkit";
import { load, update } from "@/lib/server/store";
import { logWorld, verifyProof } from "@/lib/server/world";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    sessionId?: string;
    assignmentId?: string;
    idkitResponse?: IDKitResult;
  } | null;
  if (!body?.sessionId || !body.assignmentId || !body.idkitResponse) {
    return Response.json({ error: "missing_fields" }, { status: 400 });
  }

  const assignment = (await load()).assignments.find(
    (a) => a.id === body.assignmentId && a.sessionId === body.sessionId,
  );
  if (!assignment) return Response.json({ error: "unknown_assignment" }, { status: 404 });
  if (assignment.status !== "assigned") return Response.json({ ok: true });

  const verdict = await verifyProof(body.idkitResponse, assignment.action, body.sessionId);
  if (!verdict.ok) {
    logWorld("verify/approve/confirm", verdict);
    return Response.json({ error: verdict.error, code: verdict.code, detail: verdict.detail }, { status: verdict.status });
  }

  await update((d) => {
    const a = d.assignments.find((x) => x.id === assignment.id);
    if (a && a.status === "assigned") {
      a.status = "approved";
      a.nullifier = verdict.nullifier;
    }
  });
  return Response.json({ ok: true });
}
