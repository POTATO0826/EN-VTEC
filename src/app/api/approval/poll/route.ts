import { load, update } from "@/lib/server/store";
import { pollDeviceFlow } from "@/lib/server/world";

// The browser calls this every few seconds while the human approves in World App.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { id?: string } | null;
  if (!body?.id) return Response.json({ error: "missing_id" }, { status: 400 });

  const approval = (await load()).approvals.find((a) => a.id === body.id);
  if (!approval) return Response.json({ error: "unknown_approval" }, { status: 404 });
  if (approval.status !== "pending") return Response.json({ status: approval.status });

  if (Date.now() > approval.expiresAt) {
    await update((d) => {
      const a = d.approvals.find((x) => x.id === approval.id);
      if (a) a.status = "expired";
    });
    return Response.json({ status: "expired" });
  }

  let result;
  try {
    result = await pollDeviceFlow(approval.deviceCode);
  } catch (e) {
    return Response.json(
      { status: "pending", warning: e instanceof Error ? e.message : String(e) },
    );
  }
  if (result.status === "pending" || result.status === "slow_down") {
    return Response.json({ status: "pending" });
  }

  await update((d) => {
    const a = d.approvals.find((x) => x.id === approval.id);
    if (!a) return;
    a.status = result.status;
    if (result.status === "approved") a.sub = result.sub;
  });
  return Response.json(
    result.status === "approved"
      ? { status: "approved" }
      : { status: result.status, detail: result.detail },
  );
}
