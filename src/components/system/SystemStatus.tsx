"use client";

import * as React from "react";
import { AlertTriangleIcon, PlugZapIcon, ShieldCheckIcon } from "lucide-react";
import { Panel, SectionLabel, StatusDot } from "@/components/vtec/primitives";
import { useSystemStatus } from "@/lib/api";
import { shortHash } from "@/lib/format";

/**
 * What is actually running behind this page.
 *
 * Two jobs, both about not lying:
 *
 *   1. Say whether the numbers on screen came from the chain or from fixtures.
 *      With the services down the dashboard still works, and it has to be
 *      obvious that it is working on placeholders.
 *   2. Carry the identity bridge's warning through to the screen. The bridge
 *      can issue permits with no identity journey at all so the release
 *      lifecycle can be built before World access exists; section 11's cut rule
 *      says a mock must never stand in for eligibility. The bridge stamps every
 *      such permit "dev-stub" and this is where that stamp becomes visible.
 */
export default function SystemStatus() {
  const status = useSystemStatus();

  const live = status.source === "live";
  const bridgeMode = status.bridge?.mode ?? null;

  return (
    <Panel className="gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionLabel>System</SectionLabel>
        <span className="flex items-center gap-2 text-xs tracking-[0.2em] text-muted-foreground uppercase">
          <StatusDot tone={live ? "success" : "muted"} />
          {live ? "live" : "fixtures"}
        </span>
      </div>

      {!live ? (
        <div className="flex gap-3">
          <PlugZapIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="flex flex-col gap-1.5">
            <p className="text-sm text-foreground">
              Everything on this page is a typed fixture.
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              The API is not answering, so nothing here has been read from a
              chain. Start the services to see real state:
            </p>
            <pre className="vtec-num mt-1 rounded-md border border-border/60 bg-muted/20 p-3 text-[11px] leading-relaxed text-muted-foreground">
              {"anvil\nbun run bridge\nbun run api"}
            </pre>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Row label="chain" value={`${status.api?.chainId}`} />
          <Row
            label="registry"
            value={status.api ? shortHash(status.api.registry, 10, 6) : "—"}
          />
          <Row
            label="relayer"
            value={status.api?.canRelay ? "configured" : "not configured"}
            tone={status.api?.canRelay ? undefined : "warning"}
          />
          <Row
            label="release"
            value={
              status.release
                ? status.release.statusName === "none"
                  ? "none on this channel"
                  : `${status.release.statusName} · ${shortHash(status.release.releaseId, 8, 6)}`
                : "not queried"
            }
            tone={status.release?.statusName === "revoked" ? "warning" : undefined}
          />
        </div>
      )}

      {/* The bridge's own warning, carried through verbatim rather than
          summarised, because summarising it is how it gets softened. */}
      {bridgeMode === "dev-stub" ? (
        <div className="flex gap-3 rounded-lg border border-[color-mix(in_oklab,var(--warning)_45%,transparent)] bg-[color-mix(in_oklab,var(--warning)_10%,transparent)] p-4">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-[var(--warning)]" />
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium text-[var(--warning)]">
              Identity bridge is in development stub mode
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {status.bridge?.warning}
            </p>
            {status.bridge?.missingEnv?.length ? (
              <p className="vtec-num text-[11px] text-muted-foreground">
                missing: {status.bridge.missingEnv.join(", ")}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {bridgeMode === "blocked" ? (
        <div className="flex gap-3 rounded-lg border border-border/60 p-4">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="flex flex-col gap-1.5">
            <p className="text-sm text-foreground">Identity track blocked</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              World IDP is not configured and the development stub is off, so no
              permit can be issued and nothing can be promoted. This is the
              honest state, not a failure — the optimizer and the registry still
              work.
            </p>
          </div>
        </div>
      ) : null}

      {bridgeMode === "world" ? (
        <div className="flex gap-3 rounded-lg border border-[color-mix(in_oklab,var(--success)_45%,transparent)] p-4">
          <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-[var(--success)]" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Identity bridge is configured against a real World IDP issuer. A
            permit still proves only that the bridge asserts the journey
            completed — the contract checks the bridge&apos;s signature, not a
            World token.
          </p>
        </div>
      ) : null}

      {status.checkedAt ? (
        <p className="vtec-kicker">
          checked {status.checkedAt.toLocaleTimeString()}
        </p>
      ) : null}
    </Panel>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warning";
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/40 pb-2.5 last:border-b-0">
      <span className="vtec-kicker">{label}</span>
      <span
        className={
          tone === "warning"
            ? "vtec-num text-xs text-[var(--warning)]"
            : "vtec-num text-xs text-muted-foreground"
        }
      >
        {value}
      </span>
    </div>
  );
}
