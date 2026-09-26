import { load } from "@/lib/server/store";
import { adminReady, findHumanPass } from "@/lib/server/sui";

// HumanPass lookups hit the chain; the page polls every few seconds, so keep
// answers for 20 s (shared across route bundles via globalThis).
const passCache = ((globalThis as { __vtecPass?: Map<string, { pass: string | null; at: number }> }).__vtecPass ??=
  new Map());
async function passOf(address: string) {
  const hit = passCache.get(address);
  if (hit && Date.now() - hit.at < 20_000) return hit.pass;
  const pass = await findHumanPass(address).catch(() => null);
  passCache.set(address, { pass, at: Date.now() });
  return pass;
}

// Seat, HumanPass and paired agent for one browser session. The nullifier is
// returned so the UI can show a short form of it; it identifies a seat, not a
// person.
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "missing_id" }, { status: 400 });

  const data = await load();
  const seat = data.seats.find((s) => s.sessionId === id) ?? null;
  const agent =
    data.agents
      .filter((a) => a.sessionId === id && a.hostname)
      .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))[0] ?? null;

  const wallet = data.payouts[id] ?? null;
  const humanPass = wallet && adminReady() ? await passOf(wallet) : null;

  return Response.json({
    seat: seat ? { nullifier: seat.nullifier, at: seat.at } : null,
    wallet,
    humanPass,
    agent: agent
      ? {
          code: agent.code,
          hostname: agent.hostname,
          os: agent.os,
          cpu: agent.cpu,
          gpus: agent.gpus,
          lastSeen: agent.lastSeen,
        }
      : null,
  });
}
