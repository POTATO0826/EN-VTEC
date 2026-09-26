import { load, update } from "@/lib/server/store";

const SUI_ADDRESS = /^0x[0-9a-fA-F]{64}$/;

// Where a tuner's royalties go. Read it back, or set it from the connected
// Slush account.
export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("session") ?? "";
  return Response.json({ address: (await load()).payouts[sessionId] ?? null });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { sessionId?: string; address?: string } | null;
  if (!body?.sessionId || !SUI_ADDRESS.test(body.address ?? "")) {
    return Response.json({ error: "bad_address" }, { status: 400 });
  }
  await update((d) => {
    d.payouts[body.sessionId!] = body.address!;
    // Unpaid-for submissions pick up the new address too.
    for (const s of d.submissions) if (s.sessionId === body.sessionId) s.payout = body.address!;
  });
  return Response.json({ ok: true });
}
