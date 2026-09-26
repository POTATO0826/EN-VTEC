import { load } from "@/lib/server/store";
import { grant } from "@/lib/server/downloads";
import { checkSignature, findLicense } from "@/lib/server/sui";

const FRESH_MS = 5 * 60_000;

// 1. The wallet signed "VTEC download <kernel> at <time>" -> check the signature.
// 2. That address must own an unexpired License object for this kernel on Sui.
// 3. Then, and only then, a one-use link valid for 2 minutes.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    submissionId?: string;
    address?: string;
    message?: string;
    signature?: string;
  } | null;
  if (!body?.submissionId || !body.address || !body.message || !body.signature) {
    return Response.json({ error: "missing_fields" }, { status: 400 });
  }

  const match = body.message.match(/^VTEC download (\S+) at (\d+)$/);
  if (!match || match[1] !== body.submissionId || Math.abs(Date.now() - Number(match[2])) > FRESH_MS) {
    return Response.json({ error: "stale_message", detail: "Sign a fresh download request." }, { status: 400 });
  }
  if (!(await checkSignature(body.message, body.signature, body.address))) {
    return Response.json({ error: "bad_signature", detail: "That signature isn't from this wallet." }, { status: 401 });
  }

  const license = await findLicense(body.address, body.submissionId);
  if (!license) {
    return Response.json({ error: "no_license", detail: "This wallet doesn't own a License for this kernel." }, { status: 403 });
  }
  const sub = (await load()).submissions.find((s) => s.id === body.submissionId && s.status === "verified");
  if (!sub) return Response.json({ error: "not_verified" }, { status: 404 });

  const token = grant(sub.id, body.address);
  return Response.json({ url: `/api/license/file?token=${token}`, expiresInSeconds: 120, license });
}
