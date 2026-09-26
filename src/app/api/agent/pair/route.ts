import { update } from "@/lib/server/store";

// Hands the browser a short code to give the local agent. No lookalike
// characters, so it can be typed from a screen.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function makeCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { sessionId?: string } | null;
  if (!body?.sessionId) return Response.json({ error: "missing_session" }, { status: 400 });
  const sessionId = body.sessionId;

  const code = await update((data) => {
    // Reuse an unpaired code for this session instead of piling up new ones.
    const open = data.agents.find((a) => a.sessionId === sessionId && !a.hostname);
    if (open) return open.code;
    const fresh = makeCode();
    data.agents.push({
      code: fresh,
      sessionId,
      hostname: "",
      os: "",
      cpu: "",
      gpus: [],
      lastSeen: new Date().toISOString(),
    });
    return fresh;
  });

  return Response.json({ code });
}
