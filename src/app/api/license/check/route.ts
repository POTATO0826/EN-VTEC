import { findLicense } from "@/lib/server/sui";

// Does this wallet hold an unexpired License for this kernel? (Read from Sui.)
export async function GET(request: Request) {
  const url = new URL(request.url);
  const address = url.searchParams.get("address") ?? "";
  const submission = url.searchParams.get("submission") ?? "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(address) || !submission) {
    return Response.json({ error: "missing_fields" }, { status: 400 });
  }
  const license = await findLicense(address, submission);
  return Response.json({ owned: !!license, license });
}
