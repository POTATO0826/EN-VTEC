import type { IDKitResult } from "@worldcoin/idkit";
import { load, update } from "@/lib/server/store";
import { verifyProof } from "@/lib/server/world";

// Checks the human's World ID proof for one pending approval. The proof must
// carry this approval's action and this session as the signal.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    approvalId?: string;
    sessionId?: string;
    idkitResponse?: IDKitResult;
  } | null;
  if (!body?.approvalId || !body.sessionId || !body.idkitResponse) {
    return Response.json({ error: "missing_fields" }, { status: 400 });
  }

  const approval = (await load()).approvals.find(
    (a) => a.id === body.approvalId && a.sessionId === body.sessionId && a.kind === "worldid",
  );
  if (!approval) return Response.json({ error: "unknown_approval" }, { status: 404 });
  if (approval.status === "approved") return Response.json({ ok: true });

  const verdict = await verifyProof(body.idkitResponse, approval.action, body.sessionId);
  if (!verdict.ok) {
    return Response.json(
      { error: verdict.error, code: verdict.code, detail: verdict.detail },
      { status: verdict.status },
    );
  }

  await update((d) => {
    const a = d.approvals.find((x) => x.id === approval.id);
    if (a) {
      a.status = "approved";
      a.nullifier = verdict.nullifier;
    }
  });
  return Response.json({ ok: true });
}
