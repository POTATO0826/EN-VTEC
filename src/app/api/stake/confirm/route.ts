import { load, update } from "@/lib/server/store";
import { checkStake } from "@/lib/server/sui";

// The tuner sent the stake with Slush and gives us the digest. We read the
// transaction from Sui ourselves: it must come from that wallet and move the
// full stake into the platform wallet.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    approvalId?: string;
    sessionId?: string;
    address?: string;
    digest?: string;
  } | null;
  if (!body?.approvalId || !body.sessionId || !body.digest || !/^0x[0-9a-fA-F]{64}$/.test(body.address ?? "")) {
    return Response.json({ error: "missing_fields" }, { status: 400 });
  }

  const data = await load();
  const approval = data.approvals.find(
    (a) => a.id === body.approvalId && a.sessionId === body.sessionId && a.kind === "stake",
  );
  if (!approval) return Response.json({ error: "unknown_approval" }, { status: 404 });
  if (approval.stake) return Response.json({ ok: true });
  // A stake transaction backs one approval: otherwise one payment could be
  // refunded once per kernel it was reused for.
  if (data.approvals.some((a) => a.stake?.digest === body.digest)) {
    return Response.json({ error: "stake_reused", detail: "That stake transaction is already used." }, { status: 409 });
  }

  let stake;
  try {
    stake = await checkStake(body.digest, body.address!);
  } catch (e) {
    return Response.json({ error: "stake_not_found", detail: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }

  const taken = await update((d) => {
    if (d.approvals.some((x) => x.stake?.digest === body.digest)) return true;
    const a = d.approvals.find((x) => x.id === approval.id);
    if (a) {
      a.status = "approved";
      a.stake = { digest: body.digest!, ...stake };
    }
    // Where the stake goes back to, and where license income is paid.
    d.payouts[body.sessionId!] ??= body.address!.toLowerCase();
    return false;
  });
  if (taken) {
    return Response.json({ error: "stake_reused", detail: "That stake transaction is already used." }, { status: 409 });
  }
  return Response.json({ ok: true });
}
