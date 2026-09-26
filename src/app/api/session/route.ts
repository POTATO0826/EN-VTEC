import { load } from "@/lib/server/store";

// Seat + paired agent for one browser session. Nullifier is returned so the UI
// can show a short form of it; it identifies a seat, not a person.
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "missing_id" }, { status: 400 });

  const data = await load();
  const seat = data.seats.find((s) => s.sessionId === id) ?? null;
  const agent =
    data.agents
      .filter((a) => a.sessionId === id && a.hostname)
      .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))[0] ?? null;

  return Response.json({
    seat: seat ? { nullifier: seat.nullifier, at: seat.at } : null,
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
