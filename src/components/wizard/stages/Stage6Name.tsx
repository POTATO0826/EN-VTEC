"use client";

import * as React from "react";
import { cn } from "cn";
import {
  CheckIcon,
  ExternalLinkIcon,
  GlobeIcon,
  SearchCheckIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/vtec/primitives";
import { ensUrl } from "@/data/vtec";
import {
  ActionCard,
  FeatureRow,
  PrimaryAction,
  RightPanel,
  StageLayout,
} from "../shell";
import type { Saga } from "../useSaga";

const ROOT = "gpuvtec.eth";

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 24);
}

export default function Stage6Name({ saga }: { saga: Saga }) {
  const { state, set, advance } = saga;
  const gpu = state.agent.gpu;
  const task = state.task ?? "sha256";
  const proposed = gpu ? slug(gpu.name) : "gpu";

  const [label, setLabel] = React.useState(
    () => state.ens.name?.split(".")[0] ?? proposed,
  );
  const [contributor, setContributor] = React.useState(
    state.ens.contributor ?? "",
  );

  const fullName = `${label || proposed}.${task}.${ROOT}`;
  const claimed = state.ens.status === "claimed";
  const skipped = state.ens.status === "skipped";
  const claiming = state.ens.status === "claiming";

  const claim = React.useCallback(() => {
    set((current) => ({
      ...current,
      ens: { ...current.ens, status: "claiming" },
    }));
    window.setTimeout(() => {
      set((current) => ({
        ...current,
        ens: {
          status: "claimed",
          name: fullName,
          contributor: contributor.trim() || null,
        },
      }));
    }, 1400);
  }, [contributor, fullName, set]);

  const panel = (
    <RightPanel
      label="Publishing name"
      state={claimed ? "resolved" : skipped ? "skipped" : claiming ? "writing" : "draft"}
      tone={claimed ? "success" : skipped ? "muted" : claiming ? "info" : "warning"}
      orb={state.agent.status === "found" ? "found" : "idle"}
      focal={
        <div className="flex w-full flex-col items-center gap-4">
          <GlobeIcon
            className={cn(
              "size-10",
              claimed ? "text-[var(--success)]" : "text-muted-foreground",
            )}
          />
          <code className="vtec-num text-sm break-all">
            {skipped ? "not published" : fullName}
          </code>
          <span
            className={cn(
              "inline-flex items-center gap-2 text-xs",
              claimed ? "text-[var(--success)]" : "text-muted-foreground",
            )}
          >
            <SearchCheckIcon className="size-3.5" />
            {claimed
              ? "resolves to this result"
              : skipped
                ? "nothing to resolve"
                : "not written yet"}
          </span>
        </div>
      }
      helper={
        claimed
          ? "Anyone can resolve this name without our software. That is the point of using it."
          : "Skip if you like. Results stay on your machine until you publish them."
      }
      pills={[task, ROOT, claimed ? "written" : "unwritten"]}
    />
  );

  return (
    <StageLayout
      headline="Give the result a name people can look up."
      subhead="Skip if you like. Results stay on your machine until you publish them."
      panel={panel}
    >
      <ActionCard
        n={1}
        title="Claim a subname"
        why="A name makes the result findable by someone who has never heard of this app. It is derived from the task and the card, because that is what the result is actually about."
        state={claimed ? "complete" : "active"}
      >
        <div className="flex flex-col gap-2">
          <label className="text-sm" htmlFor="ens-label">
            Subname
          </label>
          <div className="flex w-full max-w-lg items-center gap-0 rounded-lg border border-border/60 px-3 py-2">
            <input
              id="ens-label"
              value={label}
              onChange={(event) => setLabel(slug(event.target.value))}
              disabled={claimed}
              className="vtec-num min-w-0 flex-1 bg-transparent text-sm outline-none disabled:text-muted-foreground"
            />
            <span className="vtec-num text-sm whitespace-nowrap text-muted-foreground">
              .{task}.{ROOT}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm" htmlFor="ens-contributor">
            Contributor name{" "}
            <span className="text-muted-foreground">(optional)</span>
          </label>
          <input
            id="ens-contributor"
            value={contributor}
            onChange={(event) => setContributor(event.target.value)}
            disabled={claimed}
            placeholder="who ran this"
            className="w-full max-w-lg rounded-lg border border-border/60 px-3 py-2 text-sm outline-none placeholder:text-muted-foreground disabled:text-muted-foreground"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <PrimaryAction onClick={claim} disabled={claimed || claiming}>
            {claiming
              ? "Writing the record…"
              : claimed
                ? "Name written"
                : "Claim this name"}
          </PrimaryAction>
          <Button
            variant="ghost"
            className="h-11 rounded-full px-6 text-muted-foreground"
            onClick={() => {
              set((current) => ({
                ...current,
                ens: { status: "skipped", name: null, contributor: null },
              }));
              advance();
            }}
          >
            Skip for now
          </Button>
        </div>
      </ActionCard>

      <ActionCard
        n={2}
        title="Verify outside this app"
        why="A record only counts as public if you can read it without us. This link opens the name in a third-party ENS explorer, in a new tab, using none of our software."
        state={claimed ? "active" : "future"}
      >
        <div className="flex flex-col">
          <FeatureRow icon={<GlobeIcon />} title="Third-party resolver">
            app.ens.domains has no connection to this app and no reason to
            agree with it.
          </FeatureRow>
          <FeatureRow icon={<CheckIcon />} title="Load-bearing, not decorative">
            If the name does not resolve there, the publication did not happen.
          </FeatureRow>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            asChild
            variant="outline"
            disabled={!claimed}
            className={cn(
              "h-11 rounded-full px-6",
              !claimed && "pointer-events-none opacity-50",
            )}
          >
            <a
              href={ensUrl(fullName)}
              target="_blank"
              rel="noreferrer"
              aria-disabled={!claimed}
            >
              Verify outside this app
              <ExternalLinkIcon className="size-3.5" />
            </a>
          </Button>
          {!claimed ? (
            <span className="text-xs text-muted-foreground">
              Claim the name first, or skip and publish later.
            </span>
          ) : null}
        </div>

        {claimed ? (
          <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-muted/20 p-4">
            <SectionLabel>Written</SectionLabel>
            <code className="vtec-num text-sm break-all">{fullName}</code>
            {state.ens.contributor ? (
              <span className="text-sm text-muted-foreground">
                contributor: {state.ens.contributor}
              </span>
            ) : null}
          </div>
        ) : null}

        <PrimaryAction onClick={advance} disabled={!claimed && !skipped}>
          Continue to review
        </PrimaryAction>
      </ActionCard>
    </StageLayout>
  );
}
