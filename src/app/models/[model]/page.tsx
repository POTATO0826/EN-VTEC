import { notFound } from "next/navigation";
import ModelView from "@/components/models/ModelView";
import { findModel, findWorkload, onMachine } from "@/lib/models";
import { yourMachine } from "@/lib/server/machine";

export default async function ModelPage({ params, searchParams }: PageProps<"/models/[model]">) {
  const [{ model: id }, { workload }] = await Promise.all([params, searchParams]);
  const found = findModel(id);
  if (!found) notFound();
  const model = onMachine(found, await yourMachine());
  const initial = typeof workload === "string" && findWorkload(workload) ? workload : null;
  return <ModelView key={`${id}:${initial}`} model={model} initialWorkload={initial} />;
}
