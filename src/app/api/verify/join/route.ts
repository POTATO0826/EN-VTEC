import { load, update } from "@/lib/server/store";
import { assignPending } from "@/lib/server/verification";

// Joining the verifier pool needs a World ID seat: verifiers must be unique,
// real people, or one person could fill the whole pool and vote themselves in.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { sessionId?: string } | null;
  if (!body?.sessionId) return Response.json({ error: "missing_session" }, { status: 400 });

  const data = await load();
  if (!data.seats.some((s) => s.sessionId === body.sessionId)) {
    return Response.json({ error: "no_seat" }, { status: 403 });
  }

  await update((d) => {
    if (!d.verifiers.some((v) => v.sessionId === body.sessionId)) {
      d.verifiers.push({ sessionId: body.sessionId!, joinedAt: new Date().toISOString(), reputation: 0 });
    }
  });
  assignPending().catch((e) => console.warn("[verify] assign failed:", e));
  return Response.json({ ok: true });
}
