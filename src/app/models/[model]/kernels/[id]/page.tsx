import { notFound } from "next/navigation";
import KernelDetail from "@/components/models/KernelDetail";
import { findModel, findWorkload, type WorkloadId } from "@/lib/models";

export default async function KernelPage({ params, searchParams }: PageProps<"/models/[model]/kernels/[id]">) {
  const [{ model: modelId, id }, { workload }] = await Promise.all([params, searchParams]);
  const model = findModel(modelId);
  const w = typeof workload === "string" ? findWorkload(workload) : null;
  if (!model || !w) notFound();
  return <KernelDetail key={id} model={model} workloadId={w.id as WorkloadId} kernelId={id} />;
}
