import { notFound } from "next/navigation";
import ModelView from "@/components/models/ModelView";
import { findModel, findWorkload } from "@/lib/models";

export default async function ModelPage({ params, searchParams }: PageProps<"/models/[model]">) {
  const [{ model: id }, { workload }] = await Promise.all([params, searchParams]);
  const model = findModel(id);
  if (!model) notFound();
  const initial = typeof workload === "string" && findWorkload(workload) ? workload : null;
  return <ModelView key={`${id}:${initial}`} model={model} initialWorkload={initial} />;
}
