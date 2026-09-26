import { notFound } from "next/navigation";
import KernelDetail from "@/components/models/KernelDetail";
import { findModel, findWorkload, onMachine, type WorkloadId } from "@/lib/models";
import { yourMachine } from "@/lib/server/machine";

export default async function KernelPage({ params, searchParams }: PageProps<"/models/[model]/kernels/[id]">) {
  const [{ model: modelId, id }, { workload }] = await Promise.all([params, searchParams]);
  const found = findModel(modelId);
  const w = typeof workload === "string" ? findWorkload(workload) : null;
  if (!found || !w) notFound();
  const model = onMachine(found, await yourMachine());
  return <KernelDetail key={id} model={model} workloadId={w.id as WorkloadId} kernelId={id} />;
}
