import { findTrack } from "@/lib/catalog";
import { PLATFORM_SESSION, harnessRunning } from "@/lib/server/harness";
import { load, type VerifyReport } from "@/lib/server/store";
import { QUORUM } from "@/lib/server/verification";

/** Plain-language reason a report passed or failed. */
function reason(r: VerifyReport) {
  if (!r.compatible) return `Couldn't run it here: ${r.reason}.`;
  if (!r.hashMatches) return "The downloaded code didn't match the submitted hash.";
  if (!r.correct) return "Different output from the baseline on the same inputs, so it isn't correct.";
  const gain = (r.speedup - 1) * 100;
  if (gain <= 1) return `${r.speedup.toFixed(2)}× means not faster than the baseline (needs more than 1%).`;
  if (gain <= r.noisePct) return `${r.speedup.toFixed(2)}× is inside this machine's noise (±${r.noisePct}%), so it isn't proven.`;
  return `${r.speedup.toFixed(2)}× faster, beyond the noise (±${r.noisePct}%).`;
}

// Everything that happened to one submission, in order, with the evidence.
export async function GET(request: Request, ctx: RouteContext<"/api/submissions/[id]">) {
  const { id } = await ctx.params;
  const sessionId = new URL(request.url).searchParams.get("session");
  const data = await load();
  const sub = data.submissions.find((s) => s.id === id);
  if (!sub) return Response.json({ error: "not_found" }, { status: 404 });

  const approval = data.approvals.find((a) => a.id === sub.approvalId) ?? null;
  const assignments = data.assignments.filter((a) => a.submissionId === id);
  let n = 0;
  const verifiers = assignments.map((a) => ({
    who: a.sessionId === PLATFORM_SESSION ? "Platform harness" : a.sessionId === sessionId ? "You" : `Verifier ${++n}`,
    platform: a.sessionId === PLATFORM_SESSION,
    status: a.status,
    report: a.report,
    reason: a.report ? reason(a.report) : null,
  }));

  return Response.json({
    id: sub.id,
    track: findTrack(sub.trackId)?.name ?? sub.trackId,
    trackId: sub.trackId,
    mine: sub.sessionId === sessionId,
    status: sub.status,
    buildName: sub.buildName,
    buildSha256: sub.buildSha256,
    gpu: sub.gpu,
    seconds: sub.seconds,
    speedup: sub.speedup,
    at: sub.at,
    settledAt: sub.settledAt,
    approval: approval
      ? { worldId: approval.kind === "worldid" && !!approval.nullifier, fee: approval.fee }
      : null,
    draw: sub.draw,
    quorum: sub.quorum ?? QUORUM,
    harness: !!sub.harness,
    harnessRunning: harnessRunning(),
    verifiers,
    feeSettlement: sub.feeSettlement ?? null,
  });
}
