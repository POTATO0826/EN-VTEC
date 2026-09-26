import { load, loadBuild, update } from "@/lib/server/store";
import { checkRoyalty } from "@/lib/server/sui";

const ROYALTY_MIST = BigInt(Math.round(Number(process.env.NEXT_PUBLIC_ROYALTY_SUI ?? "0.1") * 1e9));

// A user paid the tuner's royalty with Slush. Check the payment on Sui, record
// it, and hand over the verified code. Re-sending the same digest re-downloads.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    submissionId?: string;
    digest?: string;
  } | null;
  if (!body?.submissionId || !body.digest) return Response.json({ error: "missing_fields" }, { status: 400 });

  const data = await load();
  const sub = data.submissions.find((s) => s.id === body.submissionId && s.status === "verified");
  if (!sub) return Response.json({ error: "not_verified" }, { status: 404 });
  if (!sub.payout) return Response.json({ error: "no_payout", detail: "This tuner hasn't set a payout address." }, { status: 409 });

  if (!data.royalties.some((r) => r.digest === body.digest)) {
    let paid;
    try {
      paid = await checkRoyalty(body.digest, sub.id, sub.payout, ROYALTY_MIST);
    } catch (e) {
      return Response.json(
        { error: "payment_not_found", detail: e instanceof Error ? e.message : String(e) },
        { status: 400 },
      );
    }
    await update((d) => {
      if (d.royalties.some((r) => r.digest === body.digest)) return;
      d.royalties.push({
        submissionId: sub.id,
        payer: paid.payer,
        tuner: sub.payout!,
        amountMist: paid.amountMist,
        digest: body.digest!,
        at: new Date().toISOString(),
      });
    });
  } else if (!data.royalties.some((r) => r.digest === body.digest && r.submissionId === sub.id)) {
    return Response.json({ error: "payment_not_found" }, { status: 400 });
  }

  const bundle = await loadBuild(sub.buildSha256);
  if (!bundle) return Response.json({ error: "build_missing" }, { status: 404 });
  return Response.json({ buildSha256: sub.buildSha256, trackId: sub.trackId, ...bundle });
}
