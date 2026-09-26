"use client";

import * as React from "react";
import Link from "next/link";
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { ArrowLeftIcon, ArrowUpRightIcon, CheckIcon, CoinsIcon, ScanFaceIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusBadge, type Status } from "@/components/ui/status-badge";
import { Step, type StepState } from "@/components/ui/step";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import SlushConnect from "@/components/sui/SlushConnect";
import WorldIdButton, { postJson } from "@/components/world/WorldIdButton";
import type { Track } from "@/lib/catalog";
import { useSessionId, useSessionStatus } from "@/lib/session";
import { explorerTx, shortAddress, stakeTx, SUI, suiReady } from "@/lib/sui-tx";

type Row = {
  id: string;
  mine: boolean;
  status: Status;
  buildName: string;
  buildSha256: string;
  gpu: string;
  seconds: number;
  speedup: number | null;
  verifiers: { assigned: number; revealed: number; passed: number };
  at: string;
};

type TrackData = { rows: Row[]; openApproval: boolean; verified: boolean; payout: string | null };

function useTrack(trackId: string, sessionId: string | null) {
  const [data, setData] = React.useState<TrackData | null>(null);
  const refresh = React.useCallback(async () => {
    if (!sessionId) return;
    const res = await fetch(`/api/tracks/${trackId}?session=${sessionId}`, { cache: "no-store" });
    if (res.ok) setData(await res.json());
  }, [trackId, sessionId]);
  React.useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [refresh]);
  return { data, refresh };
}

export default function TrackView({ track }: { track: Track }) {
  const sessionId = useSessionId();
  const { status } = useSessionStatus(sessionId);
  const { data, refresh } = useTrack(track.id, sessionId);

  // Tell the tuner the moment their new submission lands.
  const seen = React.useRef<Set<string> | null>(null);
  React.useEffect(() => {
    if (!data) return;
    const mine = data.rows.filter((r) => r.mine);
    if (seen.current) {
      for (const row of mine) {
        if (!seen.current.has(row.id)) {
          toast.success("Submission received", { description: "Pending verification by independent verifiers." });
        }
      }
    }
    seen.current = new Set(mine.map((r) => r.id));
  }, [data]);

  const hasAgent = !!status?.agent;
  const approved = !!data?.openApproval;
  const verified = !!data?.verified;

  const state = (n: 1 | 2 | 3): StepState => {
    const done = [hasAgent, approved, false];
    const first = done.indexOf(false) + 1;
    return done[n - 1] ? "done" : first === n ? "active" : "locked";
  };

  return (
    <>
      <Link href="/tuners" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
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
            <SectionTitle>Submit a build</SectionTitle>

            <Step n={1} title="Agent connected" state={state(1)} summary={status?.agent?.hostname}>
              <p className="mb-4 text-sm text-muted-foreground">Your agent isn&apos;t connected yet.</p>
              <Button asChild variant="outline" className="rounded-full">
                <Link href="/">Finish Get started</Link>
              </Button>
            </Step>

            <Step
              n={2}
              title={verified ? "Approve this submission with World ID" : `Stake ${SUI.stakeSui} SUI for this submission`}
              state={state(2)}
              summary={verified ? "approved by a verified human" : `${SUI.stakeSui} SUI staked`}
            >
              {sessionId ? (
                verified ? (
                  <WorldApproval sessionId={sessionId} trackId={track.id} onDone={refresh} />
                ) : (
                  <StakeApproval sessionId={sessionId} trackId={track.id} onDone={refresh} />
                )
              ) : null}
            </Step>

            <Step n={3} title="Run it with your agent" state={state(3)}>
              <p className="mb-3 text-sm text-muted-foreground">
                The agent hashes your code (SHA-256), runs it and uploads the exact files. The submission is then{" "}
                <span className="text-foreground">pending</span> until independent verifiers re-run it.
              </p>
              <CommandBlock>
                bun agent/vtec-agent.ts submit {status?.agent?.code ?? "<CODE>"} --track {track.id}
              </CommandBlock>
              <p className="mt-2 text-xs text-muted-foreground">
                Runs <span className="vtec-num">tracks/{track.id}/baseline</span>. For your own build add{" "}
                <span className="vtec-num">--build &lt;folder&gt;</span>; its vtec.json says how to run it.
              </p>
            </Step>
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex items-end justify-between gap-4">
              <SectionTitle>Submissions</SectionTitle>
              <Link href="/ranking" className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
                Kernel Code Efficiency Ranking <ArrowUpRightIcon className="size-3.5" />
              </Link>
            </div>
            <Submissions rows={data?.rows ?? []} />
          </section>
        </div>

        <aside className="flex flex-col gap-3 lg:sticky lg:top-6 lg:self-start">
          <Card title="Spec">
            <dl className="flex flex-col gap-3 text-sm">
              {track.spec.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
              <div>
                <dt className="text-muted-foreground">Verified when</dt>
                <dd>3 of 5 verifiers see the same output, faster by &gt;1% and beyond their noise</dd>
              </div>
            </dl>
          </Card>
          {sessionId ? <PayoutCard sessionId={sessionId} current={data?.payout ?? null} onSaved={refresh} /> : null}
        </aside>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */

function WorldApproval({ sessionId, trackId, onDone }: { sessionId: string; trackId: string; onDone: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <Explainer icon={<ScanFaceIcon />}>
        Your agent can&apos;t submit on its own. You approve each submission with World ID, and the approval works once, for
        this track only. Verified humans don&apos;t stake.
      </Explainer>
      <WorldIdButton
        label="Approve with World ID"
        sessionId={sessionId}
        start={() => postJson("/api/approval/start", { sessionId, trackId })}
        confirm={(proof, request) =>
          postJson("/api/approval/confirm", { approvalId: request.approvalId, sessionId, idkitResponse: proof })
        }
        onDone={() => {
          toast.success("Approved", { description: "Now run the submit command." });
          onDone();
        }}
      />
    </div>
  );
}

function StakeApproval({ sessionId, trackId, onDone }: { sessionId: string; trackId: string; onDone: () => void }) {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const [busy, setBusy] = React.useState(false);

  const stake = async () => {
    setBusy(true);
    const id = toast.loading("Preparing stake…");
    try {
      const res = await postJson("/api/approval/start", { sessionId, trackId });
      const data = await res.json();
      if (!res.ok) throw new Error(data.missing ? `Missing in .env.local: ${data.missing.join(", ")}` : data.error);
      if (data.kind !== "stake") throw new Error("You're verified: approve with World ID instead.");

      toast.loading("Confirm in Slush…", { id });
      const tx = await dAppKit.signAndExecuteTransaction({ transaction: stakeTx(data.approvalId) });
      if (!tx.Transaction) throw new Error(tx.FailedTransaction?.status.error?.message ?? "Transaction failed.");
      const digest = tx.Transaction.digest;

      toast.loading("Checking the stake on Sui…", { id });
      const check = await postJson("/api/approval/stake", { approvalId: data.approvalId, sessionId, digest });
      const result = await check.json();
      if (!check.ok) throw new Error(result.detail ?? result.error);

      toast.success(`${SUI.stakeSui} SUI staked`, {
        id,
        description: "Held in escrow until verification ends.",
        action: { label: "View", onClick: () => window.open(explorerTx(digest), "_blank") },
      });
      onDone();
    } catch (e) {
      toast.error("Stake didn't go through", { id, description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Explainer icon={<CoinsIcon />}>
        You&apos;re not World ID verified, so each submission is backed by a {SUI.stakeSui} SUI stake held in the VTEC
        vault on Sui. Verifiers confirm your build: you get it back. They reject it: it pays the verifiers.
      </Explainer>
      {!suiReady() ? (
        <p className="text-sm text-[var(--warning)]">The Sui contract isn&apos;t configured yet (see .env.local).</p>
      ) : account ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={stake} disabled={busy} className="w-fit rounded-full px-5">
            {busy ? "Staking…" : `Stake ${SUI.stakeSui} SUI`}
          </Button>
          <SlushConnect />
        </div>
      ) : (
        <SlushConnect label="Connect Slush to stake" />
      )}
    </div>
  );
}

function PayoutCard({ sessionId, current, onSaved }: { sessionId: string; current: string | null; onSaved: () => void }) {
  const account = useCurrentAccount();
  const save = async () => {
    if (!account) return;
    const res = await postJson("/api/payout", { sessionId, address: account.address });
    if (res.ok) {
      toast.success("Royalty address saved", { description: shortAddress(account.address) });
      onSaved();
    } else toast.error("Couldn't save that address");
  };
  return (
    <Card title="Royalties">
      <p className="text-sm text-muted-foreground">
        People who use your verified code pay you {SUI.royaltySui} SUI each time, straight to this address.
      </p>
      {current ? (
        <p className="mt-3 flex items-center gap-2 text-sm">
          <CheckIcon className="size-4 text-[var(--success)]" />
          <span className="vtec-num">{shortAddress(current)}</span>
        </p>
      ) : null}
      <div className="mt-3 flex flex-col gap-2">
        <SlushConnect />
        {account && account.address !== current ? (
          <Button variant="outline" size="sm" className="w-fit rounded-full" onClick={save}>
            Receive royalties here
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

function Submissions({ rows }: { rows: Row[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 bg-card/40 p-8 text-center text-sm text-muted-foreground">
        No submissions yet.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Status</TableHead>
            <TableHead>Build</TableHead>
            <TableHead>Verifiers</TableHead>
            <TableHead className="text-right">Speedup</TableHead>
            <TableHead>Code SHA-256</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} className={row.mine ? "bg-accent/30" : undefined}>
              <TableCell>
                <StatusBadge status={row.status} />
              </TableCell>
              <TableCell>
                <span className="block text-sm">{row.buildName}</span>
                <span className="text-xs text-muted-foreground">
                  {row.gpu}
                  {row.mine ? " · you" : ""}
                </span>
              </TableCell>
              <TableCell className="vtec-num text-sm text-muted-foreground">
                {row.verifiers.assigned === 0 ? "waiting for pool" : `${row.verifiers.revealed}/${row.verifiers.assigned} done`}
              </TableCell>
              <TableCell className="vtec-num text-right">{row.speedup ? `${row.speedup.toFixed(2)}×` : "—"}</TableCell>
              <TableCell className="vtec-num text-muted-foreground">{row.buildSha256.slice(0, 12)}…</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm tracking-[0.18em] text-muted-foreground uppercase">{children}</h2>;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/60 p-5 backdrop-blur-sm">
      <h2 className="mb-3 text-sm tracking-[0.18em] text-muted-foreground uppercase">{title}</h2>
      {children}
    </div>
  );
}

function Explainer({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <p className="flex max-w-xl gap-3 text-sm text-muted-foreground [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0">
      {icon}
      <span>{children}</span>
    </p>
  );
}

export function CommandBlock({ children }: { children: React.ReactNode }) {
  return (
    <code className="vtec-num block overflow-x-auto rounded-lg border border-border/70 bg-black/40 px-4 py-3 text-sm whitespace-nowrap">
      {children}
    </code>
  );
}
