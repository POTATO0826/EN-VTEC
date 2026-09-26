import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { PageTitle } from "@/components/ui/step";
import { MODELS, WORKLOADS, type Model } from "@/lib/models";

/** The picker: one card per local model, like a challenge board. */
export default function ModelsGrid() {
  return (
    <>
      <PageTitle
        title="Local AI models"
        subtitle="Pick the model you run. See which workloads it has verified kernels for, how much faster each one makes it, and license the kernel on Sui."
      />
      <div className="grid gap-4 md:grid-cols-2">
        {MODELS.map((model, i) => (
          <Link
            key={model.id}
            href={`/models/${model.id}`}
            className="group animate-in fade-in slide-in-from-bottom-2 fill-mode-both flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card/60 text-foreground backdrop-blur-sm transition-colors duration-500 hover:border-border hover:text-foreground"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <Constellation model={model} index={i} />
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
                <dt className="text-muted-foreground">Runs on</dt>
                <dd>{model.hardware}</dd>
                <dt className="text-muted-foreground">Weights</dt>
                <dd>
                  {model.quant} · {model.sizeGb} GB · {model.contextK}K context
                </dd>
              </dl>
              <div className="flex flex-wrap gap-1.5">
                {model.tags.map((t) => (
                  <span key={t} className="rounded-full bg-accent px-2 py-0.5 text-[11px] text-muted-foreground">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </Link>
        ))}
      </div>
      <p className="micro mt-6">
        Workload numbers on the model pages are sample data until a track measures them; kernels verified on this
        platform are merged in where a track exists.
      </p>
    </>
  );
}

/** A small line-art constellation: the six workloads around the model, coloured by status. */
function Constellation({ model, index }: { model: Model; index: number }) {
  const colour = (id: string) =>
    model.status[id as keyof typeof model.status] === "verified"
      ? "#87bb9b"
      : model.status[id as keyof typeof model.status] === "rejected"
        ? "#dc7777"
        : "#d8b072";
  return (
    <svg viewBox="0 0 400 160" className="block h-40 w-full border-b border-border/50 bg-black/30" aria-hidden>
      {WORKLOADS.map((w, i) => {
        const a = ((i / WORKLOADS.length) * Math.PI * 2 + index * 0.6) % (Math.PI * 2);
        const x = 200 + Math.cos(a) * 150;
        const y = 80 + Math.sin(a) * 52;
        return (
          <g key={w.id}>
            <line x1={200} y1={80} x2={x} y2={y} stroke="rgba(237,238,240,0.18)" strokeWidth={1} />
            <circle cx={x} cy={y} r={5} fill={colour(w.id)} />
            <circle cx={x} cy={y} r={9} fill="none" stroke={colour(w.id)} strokeOpacity={0.35} />
          </g>
        );
      })}
      <circle cx={200} cy={80} r={10} fill="#cfe6ff" />
      <circle cx={200} cy={80} r={18} fill="none" stroke="#cfe6ff" strokeOpacity={0.3} />
    </svg>
  );
}
