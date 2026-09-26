import "server-only";
import type { Machine } from "@/lib/models";
import { load } from "./store";

/**
 * The machine the model pages describe: the most recently seen paired agent
 * that reported a GPU. This is a local, single-user app, so that's the
 * laptop in front of you; null until an agent has paired.
 */
export async function yourMachine(): Promise<Machine | null> {
  const data = await load();
  const agent = data.agents
    .filter((a) => a.gpus.length > 0)
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))[0];
  if (!agent) return null;
  const gpu = agent.gpus[0];
  return {
    host: agent.hostname,
    gpu: gpu.name,
    vramGb: (gpu.memoryMb ?? 0) / 1024,
    driver: gpu.driver,
    cpu: agent.cpu,
  };
}
