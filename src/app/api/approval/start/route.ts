import { findTrack } from "@/lib/catalog";
import { load, update } from "@/lib/server/store";
import { missingAgentsEnv, startDeviceFlow } from "@/lib/server/world";

// Starts a World ID for Agents approval for one submission to one track.
export async function POST(request: Request) {
  const missing = missingAgentsEnv();
  if (missing.length > 0) {
    return Response.json({ error: "agents_not_configured", missing }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as {
    sessionId?: string;
    trackId?: string;
  } | null;
  if (!body?.sessionId || !body.trackId || !findTrack(body.trackId)) {
    return Response.json({ error: "missing_fields" }, { status: 400 });
  }

  // Only verified humans hold a seat, and only seat holders can submit.
  const data = await load();
  if (!data.seats.some((s) => s.sessionId === body.sessionId)) {
    return Response.json({ error: "no_seat" }, { status: 403 });
  }

  let flow;
  try {
    flow = await startDeviceFlow();
  } catch (e) {
    return Response.json(
      { error: "agents_unavailable", detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }

  const approval = {
    id: `ap_${crypto.randomUUID().replace(/-/g, "")}`,
    sessionId: body.sessionId,
    trackId: body.trackId,
    deviceCode: flow.device_code,
    userCode: flow.user_code,
    verificationUri: flow.verification_uri,
    verificationUriComplete: flow.verification_uri_complete ?? null,
    interval: flow.interval ?? 5,
    expiresAt: Date.now() + flow.expires_in * 1000,
    status: "pending" as const,
    sub: null,
  };
  await update((d) => {
    d.approvals.push(approval);
  });

  // The device code stays on the server; the browser only needs what the
  // human types or scans.
  return Response.json({
    id: approval.id,
    userCode: approval.userCode,
    verificationUri: approval.verificationUri,
    verificationUriComplete: approval.verificationUriComplete,
    interval: approval.interval,
    expiresAt: approval.expiresAt,
  });
}
