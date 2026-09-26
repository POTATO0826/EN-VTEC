import { load, update } from "@/lib/server/store";
import { checkStake } from "@/lib/server/sui";

// The browser staked with Slush and sends the digest. We read the transaction
// from Sui ourselves and only accept it if the vault emitted a matching stake.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    approvalId?: string;
    sessionId?: string;
    digest?: string;
  } | null;
  if (!body?.approvalId || !body.sessionId || !body.digest) {
    return Response.json({ error: "missing_fields" }, { status: 400 });
  }

  const approval = (await load()).approvals.find(
    (a) => a.id === body.approvalId && a.sessionId === body.sessionId && a.kind === "stake",
  );
  if (!approval) return Response.json({ error: "unknown_approval" }, { status: 404 });
  if (approval.status === "approved") return Response.json({ ok: true });

  let stake;
  try {
    stake = await checkStake(body.digest, approval.id);
  } catch (e) {
    return Response.json(
      { error: "stake_not_found", detail: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }

  await update((d) => {
    const a = d.approvals.find((x) => x.id === approval.id);
    if (a) {
      a.status = "approved";
      a.stake = { digest: body.digest!, ...stake };
    }
  });
  return Response.json({ ok: true });
}
