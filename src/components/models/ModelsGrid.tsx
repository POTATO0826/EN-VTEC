"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRightIcon, CpuIcon, LaptopIcon } from "lucide-react";
import ModelOrb from "@/components/models/ModelOrb";
import { PageTitle } from "@/components/ui/step";
import { fitLabel, GPU_SPECS, type Machine, type Model } from "@/lib/models";

const FIT_COLOR = { fits: "var(--success)", offload: "var(--warning)", "too-large": "var(--danger)" } as const;

/** The picker: one card per local model, judged against the laptop your agent paired from. */
export default function ModelsGrid({ models, machine }: { models: Model[]; machine: Machine | null }) {
  const [hovered, setHovered] = React.useState<string | null>(null);
  return (
    <>
      <PageTitle
        title="Local AI models"
        subtitle="Pick the model you run. See whether it fits your GPU, how fast it should go, which workloads have verified kernels, and license the kernel on Sui."
      />

      <YourMachine machine={machine} />

      <div className="grid gap-4 md:grid-cols-2">
        {models.map((model, i) => {
          const color = model.fit ? FIT_COLOR[model.fit.verdict] : "var(--muted-foreground)";
          return (
            <Link
              key={model.id}
              href={`/models/${model.id}`}
              onMouseEnter={() => setHovered(model.id)}
              onMouseLeave={() => setHovered(null)}
              className="group animate-in fade-in slide-in-from-bottom-2 fill-mode-both flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card/60 text-foreground backdrop-blur-sm transition-colors duration-500 hover:border-border hover:text-foreground"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div className="relative flex h-48 items-center justify-center overflow-hidden border-b border-border/50 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.05),rgba(0,0,0,0.45)_70%)]">
                <ModelOrb modelId={model.id} size={148} state={hovered === model.id ? "thinking" : "idle"} />
                <span
                  className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-black/40 px-2 py-0.5 text-[11px] backdrop-blur-sm"
                  style={{ color }}
                >
                  <span className="size-1.5 rounded-full" style={{ background: color }} /> {fitLabel(model)}
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-3 p-6">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-xs tracking-[0.18em] text-muted-foreground uppercase">
                    {model.vendor} · {model.params}
                  </span>
                  <ArrowRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-2xl font-medium tracking-tight">{model.name}</h2>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 px-2 py-0.5 text-[11px] tracking-[0.08em] text-[var(--success)] uppercase">
                    <span className="online-dot" /> {Object.values(model.status).filter((s) => s === "verified").length} verified
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{model.summary}</p>
                <dl className="mt-auto grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t border-border/50 pt-4 text-sm">
                  <dt className="text-muted-foreground">Weights</dt>
                  <dd>
                    {model.quant} · {model.sizeGb} GB · {model.contextK}K context
                  </dd>
                  <dt className="text-muted-foreground">Est. decode</dt>
                  <dd>
                    {model.fit ? (
                      <>
                        <span className="vtec-num">~{model.fit.decodeTps} tok/s</span>
                        <span className="text-muted-foreground">
                          {model.fit.verdict === "too-large" ? ` on ${model.hardware}` : " on your laptop"}
                        </span>
                      </>
                    ) : (
                      "—"
                    )}
                  </dd>
                </dl>
                {model.fit ? <p className="text-xs text-muted-foreground">{model.fit.note}</p> : null}
              </div>
            </Link>
          );
        })}
      </div>
      <p className="micro mt-6">
        Decode speeds are estimates from your GPU&apos;s memory bandwidth; workload numbers on the model pages are sample
        data until a track measures them. Cover orbs:{" "}
        <a href="https://orbkit.zzzzshawn.cloud/" target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">
          Orbkit
        </a>{" "}
        by zzzzshawn (MIT).
      </p>
    </>
  );
}

/** The laptop the verdicts are for, as the paired agent reported it. */
function YourMachine({ machine }: { machine: Machine | null }) {
  if (!machine) {
    return (
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-border/70 bg-card/40 p-5 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <LaptopIcon className="size-4" /> Pair your agent to see which models fit your GPU.
        </span>
        <Link href="/" className="text-foreground underline-offset-4 hover:underline">
          Get started
        </Link>
      </div>
    );
  }
  const spec = GPU_SPECS[machine.gpu];
  const facts: [string, string][] = [
    ["GPU", machine.gpu.replace(/^NVIDIA GeForce /, "")],
    ["VRAM", spec?.memory ?? `${Math.round(machine.vramGb * 10) / 10} GB`],
    ["Bandwidth", spec ? `${spec.bandwidthGBs} GB/s` : "—"],
    ["Architecture", spec?.arch ?? "—"],
    ["Driver", machine.driver ?? "—"],
    ["CPU", machine.cpu.replace(/\(R\)|\(TM\)/g, "")],
  ];
  return (
    <section className="mb-6 overflow-hidden rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-5 py-3">
        <span className="inline-flex items-center gap-2 text-sm">
          <CpuIcon className="size-4 text-muted-foreground" /> Your laptop · <span className="vtec-num">{machine.host}</span>
        </span>
        <span className="text-xs text-muted-foreground">as your paired agent reported it</span>
      </div>
      <dl className="grid grid-cols-2 gap-px bg-border/60 text-sm sm:grid-cols-3 lg:grid-cols-6">
        {facts.map(([k, v]) => (
          <div key={k} className="bg-card/80 px-4 py-3">
            <dt className="text-[10px] tracking-[0.12em] text-muted-foreground uppercase">{k}</dt>
            <dd className="mt-1 text-pretty">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
