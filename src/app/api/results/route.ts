import { resultEntries } from "@/lib/server/results";
import { load } from "@/lib/server/store";
import { kick } from "@/lib/server/verification";

// A session's recent submissions with what verifiers measured, for /results.
// ?id= adds one more submission, so a shared result link always opens.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  kick().catch((e) => console.warn("[verify] kick failed:", e));
  const data = await load();
  return Response.json({ entries: resultEntries(data, params.get("session"), params.get("id")) });
}
