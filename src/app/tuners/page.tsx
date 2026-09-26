import * as React from "react";
import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { PageTitle } from "@/components/ui/step";
import { TRACKS } from "@/lib/catalog";

export const metadata = { title: "Tuners · Opti-om" };

export default function TunersPage() {
  return (
    <>
      <PageTitle
        title="Tuners"
        subtitle="Each track is one fixed workload. Beat the baseline by at least 3%, get verified by other people's hardware, and earn every time someone licenses your kernel."
      />
      <div className="grid gap-4 md:grid-cols-2">
        {TRACKS.map((track) => (
          <Link
            key={track.id}
            href={`/tuners/${track.id}`}
            className="group flex flex-col gap-4 rounded-xl border border-border/60 bg-card/60 p-6 text-foreground backdrop-blur-sm transition-colors hover:border-border hover:text-foreground"
          >
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs tracking-[0.18em] text-muted-foreground uppercase">
                {track.category}
              </span>
              <ArrowRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </div>
            <div>
              <h2 className="text-xl font-medium">{track.name}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{track.summary}</p>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t border-border/50 pt-4 text-sm">
              {track.spec.slice(0, 2).map(([label, value]) => (
                <React.Fragment key={label}>
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd>{value}</dd>
                </React.Fragment>
              ))}
            </dl>
          </Link>
        ))}
      </div>
    </>
  );
}
