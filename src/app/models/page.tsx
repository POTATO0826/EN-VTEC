import { connection } from "next/server";
import ModelsGrid from "@/components/models/ModelsGrid";
import { MODELS, onMachine } from "@/lib/models";
import { yourMachine } from "@/lib/server/machine";

export const metadata = { title: "Models · VTEC" };

export default async function ModelsPage() {
  // The fit depends on the laptop your agent paired from, so render per request.
  await connection();
  const machine = await yourMachine();
  return <ModelsGrid models={MODELS.map((m) => onMachine(m, machine))} machine={machine} />;
}
