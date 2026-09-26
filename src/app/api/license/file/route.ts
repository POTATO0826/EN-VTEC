import { zipSync } from "fflate";
import { load, loadBuild } from "@/lib/server/store";
import { redeem } from "@/lib/server/downloads";

// The verified kernel's exact files as a zip, for a valid one-use token.
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const g = redeem(token);
  if (!g) return Response.json({ error: "expired", detail: "This download link has expired." }, { status: 410 });

  const sub = (await load()).submissions.find((s) => s.id === g.submissionId);
  const bundle = sub ? await loadBuild(sub.buildSha256) : null;
  if (!sub || !bundle) return Response.json({ error: "build_missing" }, { status: 404 });

  const files: Record<string, Uint8Array> = {};
  for (const [name, b64] of Object.entries(bundle.files)) files[name] = new Uint8Array(Buffer.from(b64, "base64"));
  const zip = zipSync(files);
  return new Response(zip, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${sub.trackId}-${sub.buildSha256.slice(0, 8)}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
