import { load } from "@/lib/server/store";
import { verificationStory } from "@/lib/server/verification-story";
import { kick } from "@/lib/server/verification";

// How one submission was verified: the tuner's own run, each verifier's
// re-run as they printed it, and the pass rule checked against their numbers.
export async function GET(request: Request, ctx: RouteContext<"/api/verification/[id]">) {
  const { id } = await ctx.params;
  kick().catch((e) => console.warn("[verify] kick failed:", e));
  const story = verificationStory(await load(), id, new URL(request.url).searchParams.get("session"));
  if (!story) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(story);
}
