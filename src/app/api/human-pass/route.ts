import { findHumanPass } from "@/lib/server/sui";

// The HumanPass object a wallet holds. The fee transaction passes it to the
// contract, which is how the chain checks the payer is a verified human.
export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address") ?? "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(address)) return Response.json({ error: "bad_address" }, { status: 400 });
  return Response.json({ pass: await findHumanPass(address) });
}
