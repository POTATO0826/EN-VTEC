import { startEarningsRequest } from "@/lib/server/earnings-recovery";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    return Response.json(await startEarningsRequest(await request.json()), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Unable to start recovery." },
      { status: 400 },
    );
  }
}
