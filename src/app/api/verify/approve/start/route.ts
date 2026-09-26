import { load } from "@/lib/server/store";
import { missingIdkitEnv, signedRequest } from "@/lib/server/world";

// Each verification needs a fresh World ID approval, bound to this one
// assignment, so a verifier can't hand their agent a blank cheque.
export async function POST(request: Request) {
  const missing = missingIdkitEnv();
  if (missing.length > 0) {
    return Response.json({ error: "world_not_configured", missing }, { status: 503 });
  }
  const body = (await request.json().catch(() => null)) as {
    sessionId?: string;
    assignmentId?: string;
  } | null;
  const assignment = (await load()).assignments.find(
    (a) => a.id === body?.assignmentId && a.sessionId === body?.sessionId,
  );
  if (!assignment) return Response.json({ error: "unknown_assignment" }, { status: 404 });

  return Response.json(signedRequest(assignment.action, "Let my Opti-om agent verify one submission"));
}
