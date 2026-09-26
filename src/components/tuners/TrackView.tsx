"use client";

import * as React from "react";
import Link from "next/link";
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { ArrowLeftIcon, ArrowUpRightIcon, CoinsIcon, ScanFaceIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusBadge, type Status } from "@/components/ui/status-badge";
import { Step, type StepState } from "@/components/ui/step";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import SlushConnect from "@/components/sui/SlushConnect";
import SubmissionDetail, { useSubmission } from "@/components/tuners/SubmissionDetail";
import WorldIdButton, { postJson } from "@/components/world/WorldIdButton";
import type { Track } from "@/lib/catalog";
import { useSessionId, useSessionStatus } from "@/lib/session";
import { explorerTx, feeTx, SUI, suiReady } from "@/lib/sui-tx";

type Row = {
  id: string;
  mine: boolean;
  status: Status;
  buildName: string;
  buildSha256: string;
  gpu: string;
  seconds: number;
  speedup: number | null;
  legacy: boolean;
  harness: boolean;
  verifiers: { assigned: number; revealed: number; passed: number };
  at: string;
};

type TrackData = {
  rows: Row[];
  verified: boolean;
  /** Where this session is: World ID done and fee unpaid, or ready to run. */
  approval: { id: string; stage: "needs_fee" | "ready" } | null;
};

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
          toast.success("Submission received", {
            description: "Verifiers are re-running it now.",
            action: { label: "Watch", onClick: () => setOpenId(row.id) },
          });
        }
      }
    }
    seen.current = new Set(mine.map((r) => r.id));
  }, [data]);

  // Submission timeline dialog; /tuners/<track>#<submission id> opens it directly.
  const [openId, setOpenId] = React.useState<string | null>(null);
  React.useEffect(() => {
    const fromHash = () => {
      const id = window.location.hash.slice(1);
      if (id.startsWith("sub_")) setOpenId(id);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);
  const detail = useSubmission(openId, sessionId);

  const hasAgent = !!status?.agent;
  const verified = !!data?.verified;
  const approved = !!data?.approval;
  const paid = data?.approval?.stage === "ready";

  // Agent -> World ID approval -> 0.5 SUI process fee -> run.
  const state = (n: 1 | 2 | 3 | 4): StepState => {
    const done = [hasAgent && verified, approved, paid, false];
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

            <Step
              n={1}
              title="Verified human, agent connected"
              state={state(1)}
              summary={`World ID · ${status?.agent?.hostname ?? ""}`}
            >
              <p className="mb-4 text-sm text-muted-foreground">
                {verified ? "Verified with World ID." : "You need to verify with World ID."}{" "}
                {hasAgent ? "Agent connected." : "Your agent isn't connected yet."}
              </p>
              <Button asChild variant="outline" className="rounded-full">
                <Link href="/">Finish Get started</Link>
              </Button>
            </Step>

            <Step n={2} title="Approve this submission with World ID" state={state(2)} summary="approved by you">
              {sessionId ? <WorldApproval sessionId={sessionId} trackId={track.id} onDone={refresh} /> : null}
            </Step>

            <Step n={3} title={`Pay the ${SUI.feeSui} SUI process fee`} state={state(3)} summary={`${SUI.feeSui} SUI paid`}>
              {sessionId && data?.approval ? (
                <FeePayment sessionId={sessionId} approvalId={data.approval.id} onDone={refresh} />
              ) : null}
            </Step>

            <Step n={4} title="Run it with your agent" state={state(4)}>
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
            <Submissions rows={data?.rows ?? []} onOpen={setOpenId} />
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
                <dd>
                  Verifiers get the same output on random inputs, and it&apos;s faster than the baseline by more than 1%
                  and beyond their noise. 3 of 5 must agree; while the pool is small, the platform harness stands in.
                </dd>
              </div>
            </dl>
          </Card>
          <Card title="Process fee">
            <p className="text-sm text-muted-foreground">
              Each submission costs {SUI.feeSui} SUI, paid with Slush after your World ID approval. It&apos;s held on Sui
              until verification ends, then split between the verifiers who re-ran your code.
            </p>
          </Card>
        </aside>
      </div>

      <Dialog
        open={!!openId}
        onOpenChange={(open) => {
          if (open) return;
          setOpenId(null);
          if (window.location.hash) history.replaceState(null, "", window.location.pathname);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto border-border bg-card sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>What happened to this submission</DialogTitle>
            <DialogDescription>Every step, with the evidence. Updates live.</DialogDescription>
          </DialogHeader>
          {detail ? <SubmissionDetail detail={detail} /> : <div className="h-40 animate-pulse rounded-lg bg-muted/30" />}
        </DialogContent>
      </Dialog>
    </>
  );
}

/* -------------------------------------------------------------------------- */

function WorldApproval({ sessionId, trackId, onDone }: { sessionId: string; trackId: string; onDone: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <Explainer icon={<ScanFaceIcon />}>
        Your agent can&apos;t submit on its own. You approve each submission with World ID, and the approval works once, for
        this track only.
      </Explainer>
      <WorldIdButton
        label="Approve with World ID"
        sessionId={sessionId}
        start={() => postJson("/api/approval/start", { sessionId, trackId })}
        confirm={(proof, request) =>
          postJson("/api/approval/confirm", { approvalId: request.approvalId, sessionId, idkitResponse: proof })
        }
        onDone={() => {
          toast.success("Approved", { description: `Now pay the ${SUI.feeSui} SUI process fee.` });
          onDone();
        }}
      />
    </div>
  );
}

function FeePayment({ sessionId, approvalId, onDone }: { sessionId: string; approvalId: string; onDone: () => void }) {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const [busy, setBusy] = React.useState(false);

  const pay = async () => {
    setBusy(true);
    const id = toast.loading("Checking your HumanPass on Sui…");
    try {
      // The contract only takes fees from wallets holding a HumanPass (World ID).
      const passRes = await fetch(`/api/human-pass?address=${account!.address}`);
      const { pass } = await passRes.json();
      if (!pass) {
        throw new Error("This wallet has no HumanPass. Verify with World ID on Get started using this Slush wallet.");
      }
      toast.loading("Confirm the fee in Slush…", { id });
      const tx = await dAppKit.signAndExecuteTransaction({ transaction: feeTx(approvalId, pass) });
      if (!tx.Transaction) throw new Error(tx.FailedTransaction?.status.error?.message ?? "Transaction failed.");
      const digest = tx.Transaction.digest;

      toast.loading("Checking the payment on Sui…", { id });
      const check = await postJson("/api/approval/fee", { approvalId, sessionId, digest });
      const result = await check.json();
      if (!check.ok) throw new Error(result.detail ?? result.error);

      toast.success(`${SUI.feeSui} SUI paid`, {
        id,
        description: "Held on Sui until the verifiers finish.",
        action: { label: "View", onClick: () => window.open(explorerTx(digest), "_blank") },
      });
      onDone();
    } catch (e) {
      toast.error("Payment didn't go through", { id, description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Explainer icon={<CoinsIcon />}>
        Verifiers spend real compute re-running your code. The {SUI.feeSui} SUI fee pays them: it&apos;s held in the VTEC
        vault on Sui and split between the verifiers who ran the check.
      </Explainer>
      {!suiReady() ? (
        <p className="text-sm text-[var(--warning)]">The Sui contract isn&apos;t configured yet (see .env.local).</p>
      ) : account ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={pay} disabled={busy} className="w-fit rounded-full px-5">
            {busy ? "Paying…" : `Pay ${SUI.feeSui} SUI`}
          </Button>
          <SlushConnect />
        </div>
      ) : (
        <SlushConnect label="Connect Slush to pay" />
      )}
    </div>
  );
}

function Submissions({ rows, onOpen }: { rows: Row[]; onOpen: (id: string) => void }) {
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
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.id}
              onClick={() => onOpen(row.id)}
              className={`cursor-pointer transition-colors hover:bg-accent/50 ${row.mine ? "bg-accent/30" : ""}`}
            >
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
              <TableCell className="text-sm text-muted-foreground">
                {row.legacy
                  ? "old, not verifiable"
                  : row.verifiers.assigned === 0
                    ? "drawing verifiers…"
                    : `${row.verifiers.revealed}/${row.verifiers.assigned} done`}
                {row.harness ? <span className="block text-xs">incl. platform harness</span> : null}
              </TableCell>
              <TableCell className="vtec-num text-right">{row.speedup ? `${row.speedup.toFixed(2)}×` : "—"}</TableCell>
              <TableCell className="vtec-num text-muted-foreground">{row.buildSha256.slice(0, 12)}…</TableCell>
              <TableCell className="text-right text-xs whitespace-nowrap text-muted-foreground">Details →</TableCell>
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
