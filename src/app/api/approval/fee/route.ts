import { load, update } from "@/lib/server/store";
import { checkFee } from "@/lib/server/sui";

// After the World ID approval, the tuner pays the process fee with Slush and
// sends the digest. We read the transaction from Sui ourselves and only accept
// it if the vault recorded a matching fee for this approval.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    approvalId?: string;
    sessionId?: string;
    digest?: string;
  } | null;
  if (!body?.approvalId || !body.sessionId || !body.digest) {
    return Response.json({ error: "missing_fields" }, { status: 400 });
  }

  const approval = (await load()).approvals.find((a) => a.id === body.approvalId && a.sessionId === body.sessionId);
  if (!approval) return Response.json({ error: "unknown_approval" }, { status: 404 });
  if (approval.status !== "approved") {
    return Response.json({ error: "not_approved", detail: "Approve with World ID first." }, { status: 409 });
  }
  if (approval.fee) return Response.json({ ok: true });

  let fee;
  try {
    fee = await checkFee(body.digest, approval.id);
  } catch (e) {
    return Response.json({ error: "fee_not_found", detail: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }

  await update((d) => {
    const a = d.approvals.find((x) => x.id === approval.id);
    if (a) a.fee = { digest: body.digest!, ...fee };
  });
  return Response.json({ ok: true });
}
