import { findTrack } from "@/lib/catalog";
import { kick } from "@/lib/server/verification";
import { load } from "@/lib/server/store";

// Kernel Code Efficiency Ranking: ONLY submissions that independent verifiers
// agreed on. Pending and verifying ones never appear here.
export async function GET() {
  kick().catch((e) => console.warn("[verify] kick failed:", e));
  const data = await load();
  const rows = data.submissions
    .filter((s) => s.status === "verified")
    .map((s) => {
      const reports = data.assignments.filter((a) => a.submissionId === s.id && a.report?.compatible);
      const royalties = data.royalties.filter((r) => r.submissionId === s.id);
      return {
        id: s.id,
        track: findTrack(s.trackId)?.name ?? s.trackId,
        trackId: s.trackId,
        buildName: s.buildName,
        buildSha256: s.buildSha256,
        gpu: s.gpu,
        speedup: s.speedup,
        verifiers: { passed: reports.filter((a) => a.report!.pass).length, total: reports.length },
        humanTuner: data.seats.some((x) => x.sessionId === s.sessionId),
        payout: s.payout,
        royalties: {
          count: royalties.length,
          mist: royalties.reduce((n, r) => n + BigInt(r.amountMist), BigInt(0)).toString(),
        },
        drawSource: s.draw?.source ?? null,
        harness: !!s.harness,
        settledAt: s.settledAt,
      };
    })
    .sort((a, b) => (b.speedup ?? 0) - (a.speedup ?? 0))
    .map((row, index) => ({ rank: index + 1, ...row }));

  return Response.json({ rows });
}
