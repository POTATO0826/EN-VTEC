import { createHash } from "node:crypto";
import { findTrack } from "@/lib/catalog";
import { saveBuild, update, type BuildRequirements, type Claim } from "@/lib/server/store";
import { optiOnReady, sui } from "@/lib/server/sui";
import { assignPending } from "@/lib/server/verification";

const SHA256 = /^[0-9a-f]{64}$/;
const MAX_BUNDLE_BYTES = 5 * 1024 * 1024;

const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);

/** The tuner's speedup claim, checked for shape so a client can't store junk in it. */
function claimOf(v: unknown): Claim | null {
  const c = v as Partial<Claim> | null;
  if (!c || typeof c !== "object" || !num(c.speedup) || c.speedup! <= 0 || c.speedup! > 1000) return null;
  const noisePct = num(c.noisePct) ? Math.min(Math.max(c.noisePct!, 0), 100) : 0;
  const runs = num(c.runs) ? Math.min(Math.max(Math.round(c.runs!), 1), 100) : 1;
  return { speedup: c.speedup!, noisePct, runs, gpu: String(c.gpu ?? "").slice(0, 120) };
}

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
// With World ID: needs an approval for this session and track with its
// process fee paid, spent once. Without World ID: no approval; the kernel
// waits ("awaiting_stake") until its tuner stakes on it in the Opti-On
// contract with this code hash, then verification starts.
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
    /** What the agent printed while tuning and submitting. */
    log?: unknown;
    /** The tuner's speedup claim, for verifiers to meet. */
    claim?: unknown;
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

    const seated = data.seats.some((s) => s.sessionId === agent.sessionId);
    let approval: (typeof data.approvals)[number] | null = null;
    if (seated) {
      const used = new Set(data.submissions.map((s) => s.approvalId));
      const open = data.approvals.filter(
        (a) =>
          a.sessionId === agent.sessionId &&
          a.trackId === track.id &&
          a.status === "approved" &&
          !used.has(a.id),
      );
      if (!open.length) return { error: "not_approved" as const };
      // Spend one that's paid; an unpaid one next to it must not hide it.
      approval = open.find((a) => !!a.fee) ?? null;
      if (!approval) return { error: "fee_unpaid" as const };
    } else if (!optiOnReady(track.id)) {
      return { error: "stake_unavailable" as const };
    }

    const id = `sub_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    data.submissions.push({
      id,
      sessionId: agent.sessionId,
      trackId: track.id,
      approvalId: approval?.id ?? null,
      buildName: String(body.buildName ?? "build").slice(0, 80),
      buildSha256: body.buildSha256!,
      specSha256,
      resultSha256: body.resultSha256!,
      seconds: body.seconds!,
      gpu: agent.gpus[0]?.name ?? agent.cpu,
      requires: body.requires ?? {},
      // Shown on the verification page; bounded so a client can't store a novel.
      tuneLog: Array.isArray(body.log) ? body.log.slice(0, 60).map((l) => String(l).slice(0, 200)) : undefined,
      claim: claimOf(body.claim),
      status: seated ? "pending" : "awaiting_stake",
      draw: null,
      speedup: null,
      payout: data.payouts[agent.sessionId] ?? null,
      at: new Date().toISOString(),
      settledAt: null,
    });
    return { id, staked: seated };
  });

  if ("error" in outcome) {
    const detail =
      outcome.error === "not_approved"
        ? "Pay the process fee on the track page first."
        : outcome.error === "fee_unpaid"
          ? "Pay the process fee on the track page first."
          : outcome.error === "stake_unavailable"
            ? "Staking isn't set up for this track (the Opti-On contract ids are missing)."
          : "Pair this agent from the Get started page first.";
    return Response.json({ error: outcome.error, detail }, { status: outcome.error === "unknown_code" ? 404 : outcome.error === "stake_unavailable" ? 503 : 403 });
  }

  await saveBuild(body.buildSha256!, { name: body.buildName ?? "build", files: body.files });
  if (!outcome.staked) {
    return Response.json({
      ok: true,
      id: outcome.id,
      status: "awaiting_stake",
      detail: `No World ID, so it waits for your stake: stake ${Number(sui.stakeMist) / 1e9} SUI on it on the track page to start verification.`,
    });
  }
  // Drawing verifiers can wait on a Sui transaction; don't hold the agent up.
  assignPending().catch((e) => console.warn("[verify] assign failed:", e));
  return Response.json({ ok: true, id: outcome.id, status: "pending" });
}
