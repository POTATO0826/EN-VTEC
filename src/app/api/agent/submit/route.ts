import { findTrack } from "@/lib/catalog";
import { update } from "@/lib/server/store";

const SHA256 = /^[0-9a-f]{64}$/;

// Called by the local agent after it has run a build. A submission is only
// accepted against a World ID for Agents approval that a human gave for this
// session and track, and each approval can be spent once.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    code?: string;
    trackId?: string;
    buildSha256?: string;
    resultSha256?: string;
    seconds?: number;
  } | null;

  if (
    !body?.code ||
    !body.trackId ||
    !findTrack(body.trackId) ||
    !SHA256.test(body.buildSha256 ?? "") ||
    !SHA256.test(body.resultSha256 ?? "") ||
    !(typeof body.seconds === "number" && body.seconds > 0)
  ) {
    return Response.json({ error: "bad_submission" }, { status: 400 });
  }

  const code = body.code.toUpperCase();
  const outcome = await update((data) => {
    const agent = data.agents.find((a) => a.code === code && a.sessionId);
    if (!agent?.sessionId) return { error: "unknown_code" as const };

    const used = new Set(data.submissions.map((s) => s.approvalId));
    const approval = data.approvals.find(
      (a) =>
        a.sessionId === agent.sessionId &&
        a.trackId === body.trackId &&
        a.status === "approved" &&
        !used.has(a.id),
    );
    if (!approval) return { error: "not_approved" as const };

    const submission = {
      id: `sub_${crypto.randomUUID().replace(/-/g, "")}`,
      sessionId: agent.sessionId,
      trackId: body.trackId!,
      approvalId: approval.id,
      buildSha256: body.buildSha256!,
      resultSha256: body.resultSha256!,
      seconds: body.seconds!,
      gpu: agent.gpus[0]?.name ?? agent.cpu,
      at: new Date().toISOString(),
    };
    data.submissions.push(submission);
    return { submission };
  });

  if ("error" in outcome) {
    const status = outcome.error === "unknown_code" ? 404 : 403;
    const detail =
      outcome.error === "not_approved"
        ? "Approve this submission with World ID on the Tuners page first."
        : "Pair this agent from the Get started page first.";
    return Response.json({ error: outcome.error, detail }, { status });
  }
  return Response.json({ ok: true, id: outcome.submission.id });
}
