import { load, loadBuild } from "@/lib/server/store";

// The exact build a verifier was assigned. Only handed to agents whose
// session actually has an assignment for it.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code")?.toUpperCase();
  const sha = url.searchParams.get("sha") ?? "";

  const data = await load();
  const agent = data.agents.find((a) => a.code === code && a.sessionId);
  if (!agent?.sessionId) return Response.json({ error: "unknown_code" }, { status: 404 });

  const allowed = data.assignments.some((a) => {
    if (a.sessionId !== agent.sessionId) return false;
    return data.submissions.some((s) => s.id === a.submissionId && s.buildSha256 === sha);
  });
  if (!allowed) return Response.json({ error: "not_assigned" }, { status: 403 });

  const bundle = await loadBuild(sha);
  if (!bundle) return Response.json({ error: "build_missing" }, { status: 404 });
  return Response.json(bundle);
}
