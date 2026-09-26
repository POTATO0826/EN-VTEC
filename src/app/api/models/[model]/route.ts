import { findModel, type KernelRow, type WorkloadId } from "@/lib/models";
import { load } from "@/lib/server/store";
import { kick } from "@/lib/server/verification";

// Kernels verified on this platform for a model: every verified submission on
// a track the model maps to a workload. Sample rows live in the browser.
export async function GET(_request: Request, ctx: RouteContext<"/api/models/[model]">) {
  const { model: id } = await ctx.params;
  const model = findModel(id);
  if (!model) return Response.json({ error: "unknown_model" }, { status: 404 });

  kick().catch((e) => console.warn("[verify] kick failed:", e));
  const data = await load();
  const rows: KernelRow[] = [];
  for (const [workloadId, trackId] of Object.entries(model.tracks) as [WorkloadId, string][]) {
    for (const s of data.submissions.filter((x) => x.trackId === trackId && x.status === "verified")) {
      const reports = data.assignments.filter((a) => a.submissionId === s.id && a.report?.compatible);
      rows.push({
        id: s.id,
        modelId: model.id,
        workloadId,
        name: s.buildName,
        tuner: data.payouts[s.sessionId] ?? null,
        buildSha256: s.buildSha256,
        speedup: s.speedup ?? 0,
        verifiers: { passed: reports.filter((a) => a.report!.pass).length, total: reports.length },
        harness: !!s.harness,
        listing: s.listing ?? null,
        status: "verified",
        submittedAt: s.at,
        sample: false,
        trackId,
      });
    }
  }
  return Response.json({ rows });
}
