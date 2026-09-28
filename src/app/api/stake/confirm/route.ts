import { load, update } from "@/lib/server/store";
import { checkOnChainStake, optiOn, sui } from "@/lib/server/sui";
import { assignPending } from "@/lib/server/verification";

// Without World ID: the tuner staked on their uploaded kernel in the Opti-On
// contract (market::submit, with the kernel's code hash) and gives us the
// digest. We read the Submitted event from Sui ourselves: right challenge,
// right wallet, right code hash. Then verification starts.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    submissionId?: string;
    sessionId?: string;
    address?: string;
    digest?: string;
  } | null;
  if (!body?.submissionId || !body.sessionId || !body.digest || !/^0x[0-9a-fA-F]{64}$/.test(body.address ?? "")) {
    return Response.json({ error: "missing_fields" }, { status: 400 });
  }

  const data = await load();
  const sub = data.submissions.find((s) => s.id === body.submissionId && s.sessionId === body.sessionId);
  if (!sub) return Response.json({ error: "unknown_submission" }, { status: 404 });
  if (sub.stake) return Response.json({ ok: true });
  if (sub.status !== "awaiting_stake") {
    return Response.json({ error: "not_awaiting_stake", detail: "This kernel doesn't need a stake." }, { status: 409 });
  }
  const challengeId = optiOn.challenges[sub.trackId];
  if (!challengeId) return Response.json({ error: "stake_unavailable", detail: "No Opti-On challenge for this track." }, { status: 503 });
  if (data.submissions.some((s) => s.stake?.digest === body.digest)) {
    return Response.json({ error: "stake_reused", detail: "That stake transaction is already used." }, { status: 409 });
  }

  let staked;
  try {
    staked = await checkOnChainStake(body.digest, { tuner: body.address!, challengeId, codeHashHex: sub.buildSha256 });
  } catch (e) {
    return Response.json({ error: "stake_not_found", detail: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }

  const taken = await update((d) => {
    if (d.submissions.some((s) => s.stake && (s.stake.digest === body.digest || s.stake.onchainId === staked.onchainId))) return true;
    const s = d.submissions.find((x) => x.id === sub.id);
    if (s && s.status === "awaiting_stake") {
      s.stake = { ...staked, digest: body.digest!, challengeId, amountMist: String(sui.stakeMist) };
      s.status = "pending";
      // Where license income is paid.
      s.payout ??= staked.tuner;
      d.payouts[body.sessionId!] ??= staked.tuner;
    }
    return false;
  });
  if (taken) return Response.json({ error: "stake_reused", detail: "That stake is already used." }, { status: 409 });

  assignPending().catch((e) => console.warn("[verify] assign failed:", e));
  return Response.json({ ok: true, onchainId: staked.onchainId });
}
