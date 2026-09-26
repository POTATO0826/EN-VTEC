import type { IDKitResult } from "@worldcoin/idkit";
import { update } from "@/lib/server/store";
import { adminReady, findHumanPass, mintHumanPass } from "@/lib/server/sui";
import { idkit, logWorld, missingIdkitEnv, verifyProof } from "@/lib/server/world";

const SUI_ADDRESS = /^0x[0-9a-fA-F]{64}$/;

// World ID -> Sui. The proof's signal is the person's Sui address, so the
// proof only counts for that wallet. Once World verifies it, the platform
// mints a non-transferable HumanPass to that address: from then on the chain
// itself knows this wallet belongs to a verified, unique human.
export async function POST(request: Request) {
  const missing = missingIdkitEnv();
  if (missing.length > 0) {
    return Response.json({ error: "world_not_configured", missing }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as {
    sessionId?: string;
    address?: string;
    idkitResponse?: IDKitResult;
  } | null;
  if (!body?.sessionId || !body.idkitResponse || !SUI_ADDRESS.test(body.address ?? "")) {
    return Response.json({ error: "missing_fields", detail: "Connect Slush before verifying." }, { status: 400 });
  }
  const address = body.address!.toLowerCase();

  // "sui:" prefix: a bare 0x... string is hashed as raw bytes by IDKit but may
  // be read as text elsewhere; a text prefix makes every side hash the same.
  const verdict = await verifyProof(body.idkitResponse, idkit.seatAction, `sui:${address}`);
  if (!verdict.ok) {
    logWorld("claim-seat", verdict);
    return Response.json({ error: verdict.error, code: verdict.code, detail: verdict.detail }, { status: verdict.status });
  }

  const { nullifier } = verdict;
  const sessionId = body.sessionId;
  const result = await update((data) => {
    const existing = data.seats.find((s) => s.nullifier === nullifier);
    if (existing && existing.sessionId !== sessionId && data.payouts[existing.sessionId] !== address) {
      return "taken" as const;
    }
    if (!existing) data.seats.push({ nullifier, sessionId, at: new Date().toISOString() });
    else existing.sessionId = sessionId;
    data.payouts[sessionId] = address;
    return "ok" as const;
  });
  if (result === "taken") {
    return Response.json(
      { error: "seat_taken", detail: "This World ID is already bound to another wallet." },
      { status: 409 },
    );
  }

  // Mint the HumanPass on Sui (once per human; the contract enforces it too).
  let pass = adminReady() ? await findHumanPass(address) : null;
  let digest: string | null = null;
  if (adminReady() && !pass) {
    try {
      digest = (await mintHumanPass(address, nullifier)).digest;
      pass = await findHumanPass(address);
    } catch (e) {
      return Response.json(
        { error: "pass_failed", detail: e instanceof Error ? e.message : String(e) },
        { status: 502 },
      );
    }
  }
  return Response.json({ ok: true, nullifier, pass, digest });
}
