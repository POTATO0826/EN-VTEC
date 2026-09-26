"use client";

import type { ComponentType } from "react";
import type { OrbState } from "@/components/ui/orbkit-core";
import Shdr11 from "@/components/ui/shdr-11";
import Shdr13 from "@/components/ui/shdr-13";
import Shdr16 from "@/components/ui/shdr-16";
import Shdr17 from "@/components/ui/shdr-17";
import Shdr21 from "@/components/ui/shdr-21";
import Shdr32 from "@/components/ui/shdr-32";

type Orb = ComponentType<{ size?: number; state?: OrbState }>;

/** Each model's cover orb, from Orbkit (MIT). */
const ORBS: Record<string, Orb> = {
  "kimi-k3": Shdr32, // a galaxy
  "kimi-k2": Shdr21, // light through a cloud
  "qwen3-8b": Shdr13, // a plasma globe
  "llama-3.1-8b": Shdr16, // caustics
  "deepseek-r1-14b": Shdr11, // a quantum orbital, for the reasoner
  "gemma-3-27b": Shdr17, // a many-coloured storm, for the multimodal one
};

export default function ModelOrb({ modelId, size, state = "idle" }: { modelId: string; size: number; state?: OrbState }) {
  const Orb = ORBS[modelId] ?? Shdr21;
  return <Orb size={size} state={state} />;
}
