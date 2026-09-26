import { findTrack } from "@/lib/catalog";
import { load } from "@/lib/server/store";

// Seat + paired agent for one browser session, plus where the session is in
// the overall journey (latest approval and latest submission). The nullifier
// is returned so the UI can show a short form of it; it identifies a seat, not
// a person.
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "missing_id" }, { status: 400 });

  const data = await load();
  const seat = data.seats.find((s) => s.sessionId === id) ?? null;
  const agent =
    data.agents
      .filter((a) => a.sessionId === id && a.hostname)
      .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))[0] ?? null;

  // The newest approval that hasn't been spent on a submission yet.
  const used = new Set(data.submissions.map((s) => s.approvalId));
  const approval =
    data.approvals
      .filter((a) => a.sessionId === id && a.status === "approved" && !used.has(a.id))
      .sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;

  const submission =
    data.submissions.filter((s) => s.sessionId === id).sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;

  return Response.json({
    seat: seat ? { nullifier: seat.nullifier, at: seat.at } : null,
    agent: agent
      ? {
          code: agent.code,
          hostname: agent.hostname,
          os: agent.os,
          cpu: agent.cpu,
          gpus: agent.gpus,
          lastSeen: agent.lastSeen,
        }
      : null,
    approval: approval
      ? { id: approval.id, trackId: approval.trackId, paid: !!approval.fee }
      : null,
    submission: submission
      ? {
          id: submission.id,
          trackId: submission.trackId,
          track: findTrack(submission.trackId)?.name ?? submission.trackId,
          status: submission.status,
          at: submission.at,
        }
      : null,
  });
}
