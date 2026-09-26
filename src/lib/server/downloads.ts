import "server-only";

/**
 * Short-lived download links, handed out only after a wallet proves (by
 * signature) that it owns a License for the kernel. Kept in memory on
 * globalThis so every route bundle shares them; they expire in 2 minutes.
 */
type Grant = { submissionId: string; address: string; expires: number };

const grants = ((globalThis as { __vtecDownloads?: Map<string, Grant> }).__vtecDownloads ??= new Map());

export function grant(submissionId: string, address: string) {
  const token = crypto.randomUUID().replace(/-/g, "");
  grants.set(token, { submissionId, address, expires: Date.now() + 2 * 60_000 });
  return token;
}

export function redeem(token: string) {
  const g = grants.get(token);
  if (!g) return null;
  grants.delete(token); // one use
  return g.expires > Date.now() ? g : null;
}
