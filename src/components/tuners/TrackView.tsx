"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangleIcon, ArrowLeftIcon, ExternalLinkIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Step, type StepState } from "@/components/ui/step";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Track } from "@/lib/catalog";
import { useSessionId, useSessionStatus } from "@/lib/session";

type Row = {
  rank: number;
  mine: boolean;
  gpu: string;
  seconds: number;
  buildSha256: string;
  resultSha256: string;
  at: string;
};

function useLeaderboard(trackId: string, sessionId: string | null) {
  const [data, setData] = React.useState<{ rows: Row[]; openApproval: boolean } | null>(null);
  const refresh = React.useCallback(async () => {
    const res = await fetch(`/api/tracks/${trackId}?session=${sessionId ?? ""}`, { cache: "no-store" });
    if (res.ok) setData(await res.json());
  }, [trackId, sessionId]);
  React.useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 4000);
    return () => clearInterval(timer);
  }, [refresh]);
  return { data, refresh };
}

export default function TrackView({ track }: { track: Track }) {
  const sessionId = useSessionId();
  const { status } = useSessionStatus(sessionId);
  const { data, refresh } = useLeaderboard(track.id, sessionId);
  const [approved, setApproved] = React.useState(false);

  const hasSeat = !!status?.seat;
  const hasAgent = !!status?.agent;
  const mine = data?.rows.find((r) => r.mine) ?? null;
  const approvalReady = approved || !!data?.openApproval;
  // A submission spends the approval, so a new result means step 2 is done.
  const submitted = !!mine && !data?.openApproval;

  const state = (n: 1 | 2 | 3 | 4): StepState => {
    const done = [hasSeat && hasAgent, approvalReady || submitted, submitted, false][n - 1];
    const firstOpen = [hasSeat && hasAgent, approvalReady || submitted, submitted, false].indexOf(false) + 1;
    return done ? "done" : firstOpen === n ? "active" : "locked";
  };

  return (
    <>
      <Link href="/tuners" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-3.5" /> All tracks
      </Link>

      <div className="mb-8 flex flex-col gap-2">
        <span className="text-xs tracking-[0.18em] text-muted-foreground uppercase">{track.category}</span>
        <h1 className="text-3xl font-medium tracking-tight md:text-4xl">{track.name}</h1>
        <p className="max-w-2xl text-muted-foreground">{track.summary}</p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-8">
          <section className="flex flex-col gap-3">
            <h2 className="text-sm tracking-[0.18em] text-muted-foreground uppercase">Submit a build</h2>

            <Step n={1} title="Seat and agent" state={state(1)} summary="verified human · agent connected">
              <p className="mb-4 text-sm text-muted-foreground">
                {hasSeat ? "Seat claimed." : "You need a World ID seat."}{" "}
                {hasAgent ? "Agent connected." : "Your agent isn't connected."}
              </p>
              <Button asChild variant="outline" className="rounded-full">
                <Link href="/">Finish Get started</Link>
              </Button>
            </Step>

            <Step n={2} title="Approve this submission with World ID" state={state(2)} summary="approved by a human">
              {sessionId ? (
                <AgentApproval
                  sessionId={sessionId}
                  trackId={track.id}
                  onApproved={() => {
                    setApproved(true);
                    refresh();
                  }}
                />
              ) : null}
            </Step>

            <Step
              n={3}
              title="Run it with your agent"
              state={state(3)}
              summary={mine ? <span className="vtec-num">{mine.seconds.toFixed(2)} s · {mine.buildSha256.slice(0, 10)}…</span> : null}
            >
              <p className="mb-3 text-sm text-muted-foreground">
                The agent hashes your build with SHA-256, runs it, hashes the output and submits both.
              </p>
              <code className="vtec-num block overflow-x-auto rounded-lg border border-border/70 bg-black/40 px-4 py-3 text-sm whitespace-nowrap">
                bun agent/vtec-agent.ts submit {status?.agent?.code ?? "<CODE>"} --track {track.id} --build ./my-build --run
                &quot;&lt;your benchmark command&gt;&quot;
              </code>
              <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                <span className="inline-block size-2 animate-pulse rounded-full bg-[var(--warning)]" />
                Waiting for the result…
              </p>
            </Step>

            <Step n={4} title="Stake to enter the leaderboard" state={state(4)}>
              <p className="text-sm text-muted-foreground">
                Your stake is held in escrow on Sepolia. Beat the record by more than 1% and it comes back.
              </p>
            </Step>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-sm tracking-[0.18em] text-muted-foreground uppercase">Leaderboard</h2>
            <Leaderboard rows={data?.rows ?? []} metric={track.metric} />
          </section>
        </div>

        <aside className="flex flex-col gap-3 lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-xl border border-border/60 bg-card/60 p-5 backdrop-blur-sm">
            <h2 className="mb-3 text-sm tracking-[0.18em] text-muted-foreground uppercase">Spec</h2>
            <dl className="flex flex-col gap-3 text-sm">
              {track.spec.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
              <div>
                <dt className="text-muted-foreground">Ranked by</dt>
                <dd>{track.metric}, lower is better</dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */

type ApprovalState =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "waiting"; id: string; userCode: string; url: string; interval: number }
  | { kind: "error"; title: string; detail: string };

const APPROVAL_ERRORS: Record<string, string> = {
  agents_not_configured: "World ID for Agents isn't set up on the server yet.",
  agents_unavailable: "Couldn't reach World ID for Agents.",
  no_seat: "Claim your World ID seat on Get started first.",
};

function AgentApproval({
  sessionId,
  trackId,
  onApproved,
}: {
  sessionId: string;
  trackId: string;
  onApproved: () => void;
}) {
  const [state, setState] = React.useState<ApprovalState>({ kind: "idle" });

  const start = async () => {
    setState({ kind: "starting" });
    const res = await fetch("/api/approval/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, trackId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setState({
        kind: "error",
        title: APPROVAL_ERRORS[data.error] ?? "Couldn't start the approval",
        detail: data.missing ? `Missing in .env.local: ${data.missing.join(", ")}` : (data.detail ?? ""),
      });
      return;
    }
    setState({
      kind: "waiting",
      id: data.id,
      userCode: data.userCode,
      url: data.verificationUriComplete ?? data.verificationUri,
      interval: data.interval,
    });
  };

  // Poll at the interval the issuer asked for until the human decides.
  React.useEffect(() => {
    if (state.kind !== "waiting") return;
    const timer = setInterval(async () => {
      const res = await fetch("/api/approval/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: state.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.status === "approved") {
        clearInterval(timer);
        setState({ kind: "idle" });
        onApproved();
      } else if (data.status === "denied" || data.status === "expired") {
        clearInterval(timer);
        setState({
          kind: "error",
          title: data.status === "denied" ? "Not approved" : "The code expired",
          detail: data.detail ?? "Start a new approval to try again.",
        });
      }
    }, Math.max(state.interval, 2) * 1000);
    return () => clearInterval(timer);
  }, [state, onApproved]);

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-xl text-sm text-muted-foreground">
        Your agent can't submit on its own. A human has to approve each submission in World App, so a rogue or hijacked
        agent can't spend your stake.
      </p>

      {state.kind === "error" ? (
        <Alert variant="warning">
          <AlertTriangleIcon />
          <AlertTitle>{state.title}</AlertTitle>
          {state.detail ? <AlertDescription>{state.detail}</AlertDescription> : null}
        </Alert>
      ) : null}

      {state.kind === "waiting" ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border/70 bg-black/30 p-4">
          <span className="text-sm text-muted-foreground">Open the link and approve with World App. Your code:</span>
          <span className="vtec-num text-2xl tracking-[0.2em]">{state.userCode}</span>
          <a
            href={state.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-fit items-center gap-1.5 text-sm underline-offset-4 hover:underline"
          >
            Approve in World <ExternalLinkIcon className="size-3.5" />
          </a>
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="inline-block size-2 animate-pulse rounded-full bg-[var(--warning)]" />
            Waiting for approval…
          </span>
        </div>
      ) : (
        <Button onClick={start} disabled={state.kind === "starting"} className="w-fit rounded-full px-5">
          {state.kind === "starting" ? "Starting…" : "Approve with World ID"}
        </Button>
      )}
    </div>
  );
}

function Leaderboard({ rows, metric }: { rows: Row[]; metric: string }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 bg-card/40 p-8 text-center text-sm text-muted-foreground">
        No results yet. The first verified build sets the record.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">#</TableHead>
            <TableHead>Hardware</TableHead>
            <TableHead className="text-right">{metric}</TableHead>
            <TableHead>Build SHA-256</TableHead>
            <TableHead>Stake</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.buildSha256 + row.at} className={row.mine ? "bg-accent/40" : undefined}>
              <TableCell className="vtec-num">{row.rank}</TableCell>
              <TableCell>
                {row.gpu}
                {row.mine ? <span className="ml-2 text-xs text-muted-foreground">you</span> : null}
              </TableCell>
              <TableCell className="vtec-num text-right">{row.seconds.toFixed(3)}</TableCell>
              <TableCell className="vtec-num text-muted-foreground">{row.buildSha256.slice(0, 16)}…</TableCell>
              <TableCell className="text-muted-foreground">not staked</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
