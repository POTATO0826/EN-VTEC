import { update, type AgentInfo } from "@/lib/server/store";

// Called by the local agent (agent/vtec-agent.ts) with its pairing code and
// what it found on the machine.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Partial<AgentInfo> | null;
  if (!body?.code) return Response.json({ error: "missing_code" }, { status: 400 });

  const code = body.code.toUpperCase();
  const found = await update((data) => {
    const agent = data.agents.find((a) => a.code === code);
    if (!agent) return false;
    agent.hostname = String(body.hostname ?? "unknown");
    agent.os = String(body.os ?? "");
    agent.cpu = String(body.cpu ?? "");
    agent.gpus = Array.isArray(body.gpus) ? body.gpus.slice(0, 8) : [];
    agent.lastSeen = new Date().toISOString();
    return true;
  });

  if (!found) return Response.json({ error: "unknown_code" }, { status: 404 });
  return Response.json({ ok: true });
}
