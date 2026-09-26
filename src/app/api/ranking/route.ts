import { findTrack } from "@/lib/catalog";
import { load } from "@/lib/server/store";
import { kick } from "@/lib/server/verification";

// Kernel Code Efficiency Ranking: ONLY submissions that verifiers agreed on.
// Pending and verifying ones never appear here. Each verified kernel has a
// Listing on Sui that buyers purchase a License from.
export async function GET() {
  kick().catch((e) => console.warn("[verify] kick failed:", e));
  const data = await load();
  const rows = data.submissions
    .filter((s) => s.status === "verified")
    .map((s) => {
      const reports = data.assignments.filter((a) => a.submissionId === s.id && a.report?.compatible);
      return {
        id: s.id,
        track: findTrack(s.trackId)?.name ?? s.trackId,
        trackId: s.trackId,
        buildName: s.buildName,
        buildSha256: s.buildSha256,
        gpu: s.gpu,
        speedup: s.speedup,
        verifiers: { passed: reports.filter((a) => a.report!.pass).length, total: reports.length },
        harness: !!s.harness,
        tuner: data.payouts[s.sessionId] ?? null,
        listing: s.listing ?? null,
        settledAt: s.settledAt,
      };
    })
    .sort((a, b) => (b.speedup ?? 0) - (a.speedup ?? 0))
    .map((row, index) => ({ rank: index + 1, ...row }));

  return Response.json({ rows });
}
