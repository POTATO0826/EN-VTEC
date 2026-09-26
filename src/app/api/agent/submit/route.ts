import { createHash } from "node:crypto";
import { findTrack } from "@/lib/catalog";
import { saveBuild, update, type BuildRequirements } from "@/lib/server/store";
import { assignPending } from "@/lib/server/verification";

const SHA256 = /^[0-9a-f]{64}$/;
const MAX_BUNDLE_BYTES = 5 * 1024 * 1024;

/** Recomputes the build hash exactly the way the agent does. */
function hashFiles(files: Record<string, string>) {
  const h = createHash("sha256");
  for (const name of Object.keys(files).sort()) {
    h.update(name);
    h.update(Buffer.from(files[name], "base64"));
  }
  return h.digest("hex");
}

// Called by the local agent after it ran a build. The submission is recorded
// as PENDING: it only reaches the ranking once independent verifiers agree.
// Needs an approval (World ID or SUI stake) for this session and track, and
// each approval can be spent once.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    code?: string;
    trackId?: string;
    buildName?: string;
    buildSha256?: string;
    resultSha256?: string;
    seconds?: number;
    requires?: BuildRequirements;
    files?: Record<string, string>;
  } | null;

  const track = body?.trackId ? findTrack(body.trackId) : null;
  if (
    !body?.code ||
    !track ||
    !SHA256.test(body.buildSha256 ?? "") ||
    !SHA256.test(body.resultSha256 ?? "") ||
    !(typeof body.seconds === "number" && body.seconds > 0) ||
    !body.files ||
    typeof body.files !== "object"
  ) {
    return Response.json({ error: "bad_submission" }, { status: 400 });
  }

  const size = Object.values(body.files).reduce((n, b64) => n + b64.length * 0.75, 0);
  if (size > MAX_BUNDLE_BYTES) {
    return Response.json({ error: "build_too_large", detail: "Builds are limited to 5 MB." }, { status: 413 });
  }
  // The code hash is what verifiers will test, so it must match the files.
  if (hashFiles(body.files) !== body.buildSha256) {
    return Response.json({ error: "hash_mismatch", detail: "Build files don't match the build hash." }, { status: 400 });
  }

  const specSha256 = createHash("sha256").update(JSON.stringify(track.spec)).digest("hex");
  const code = body.code.toUpperCase();

  const outcome = await update((data) => {
    const agent = data.agents.find((a) => a.code === code && a.sessionId);
    if (!agent?.sessionId) return { error: "unknown_code" as const };

    const used = new Set(data.submissions.map((s) => s.approvalId));
    const approval = data.approvals.find(
      (a) =>
        a.sessionId === agent.sessionId &&
        a.trackId === track.id &&
        a.status === "approved" &&
        !used.has(a.id),
    );
    if (!approval) return { error: "not_approved" as const };

    const id = `sub_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    data.submissions.push({
      id,
      sessionId: agent.sessionId,
      trackId: track.id,
      approvalId: approval.id,
      buildName: String(body.buildName ?? "build").slice(0, 80),
      buildSha256: body.buildSha256!,
      specSha256,
      resultSha256: body.resultSha256!,
      seconds: body.seconds!,
      gpu: agent.gpus[0]?.name ?? agent.cpu,
      requires: body.requires ?? {},
      status: "pending",
      draw: null,
      speedup: null,
      payout: data.payouts[agent.sessionId] ?? approval.stake?.owner ?? null,
      at: new Date().toISOString(),
      settledAt: null,
    });
    return { id };
  });

  if ("error" in outcome) {
    const detail =
      outcome.error === "not_approved"
        ? "Approve this submission on the track page first (World ID, or a SUI stake if you're not verified)."
        : "Pair this agent from the Get started page first.";
    return Response.json({ error: outcome.error, detail }, { status: outcome.error === "unknown_code" ? 404 : 403 });
  }

  await saveBuild(body.buildSha256!, { name: body.buildName ?? "build", files: body.files });
  // Drawing verifiers can wait on a Sui transaction; don't hold the agent up.
  assignPending().catch((e) => console.warn("[verify] assign failed:", e));
  return Response.json({ ok: true, id: outcome.id, status: "pending" });
}
