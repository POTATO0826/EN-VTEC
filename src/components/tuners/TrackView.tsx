"use client";

import * as React from "react";
import Link from "next/link";
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { ArrowLeftIcon, CheckIcon, CoinsIcon, LoaderIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge, type Status } from "@/components/ui/status-badge";
import { Step, type StepState } from "@/components/ui/step";
import SlushConnect from "@/components/sui/SlushConnect";
import { postJson } from "@/components/world/WorldIdButton";
import type { Track } from "@/lib/catalog";
import { useSessionId, useSessionStatus } from "@/lib/session";
import { useOrigin } from "@/lib/use-origin";
import { explorerTx, feeTx, stakeTx, SUI, suiReady } from "@/lib/sui-tx";

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
  builds: { folder: string; name: string }[];
  verified: boolean;
  /** Where this session is: World ID done and fee unpaid, or ready to run (by World ID + fee, or by a stake). */
  approval: { id: string; stage: "needs_fee" | "ready"; mode?: "worldid" | "stake" } | null;
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

  // Tell the tuner the moment their new submission lands, and again when the
  // verifiers (or the platform harness) have decided it, with a link to the result.
  const [running, setRunning] = React.useState<string | null>(null);
  const seen = React.useRef<Map<string, Status> | null>(null);
  React.useEffect(() => {
    if (!data) return;
    const mine = data.rows.filter((r) => r.mine);
    if (seen.current) {
      for (const row of mine) {
        const before = seen.current.get(row.id);
        if (before === undefined) {
          setRunning(row.id);
        } else if (before !== row.status && (row.status === "verified" || row.status === "rejected")) {
          const view = { label: "View result", onClick: () => setRunning(row.id) };
          if (row.status === "verified") {
            toast.success(`Verified at ${row.speedup?.toFixed(2)}×`, {
              description: `${row.buildName} is on the ranking.`,
              action: view,
            });
          } else {
            toast("Not proven faster", { description: `${row.buildName} stays off the ranking.`, action: view });
          }
        }
      }
    }
    seen.current = new Map(mine.map((r) => [r.id, r.status]));
  }, [data]);

  // #run_<id> (the agent prints it) opens the running dialog for that submission;
  // older #<id> links go to the submission's result page.
  React.useEffect(() => {
    const fromHash = () => {
      const id = window.location.hash.slice(1);
      if (id.startsWith("run_")) setRunning(id.slice(4));
      else if (id.startsWith("sub_")) setRunning(id);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  const hasAgent = !!status?.agent;
  const verified = !!data?.verified;
  const paid = data?.approval?.stage === "ready";

  // With World ID (verified once, at Get started): agent -> process fee -> run.
  // Without:  agent -> stake -> run. The stake comes back if the kernel
  // verifies (correct, at least 0.1% faster); otherwise it's slashed.
  const done = [hasAgent, paid, false];
  const state = (n: number): StepState => {
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
              title="Agent connected"
              state={state(1)}
              summary={`${verified ? "World ID" : "no World ID"} · ${status?.agent?.hostname ?? ""}`}
            >
              <p className="mb-4 text-sm text-muted-foreground">
                {verified
                  ? "Verified with World ID at Get started, so there's no second check: you pay the process fee per submission."
                  : `No World ID: you stake ${SUI.stakeSui} SUI per kernel instead. It comes back if the kernel verifies.`}{" "}
                {hasAgent ? "Agent connected." : "Your agent isn't connected yet."}
              </p>
              <Button asChild variant="outline" className="rounded-full">
                <Link href="/">Finish Get started</Link>
              </Button>
            </Step>

            {verified ? (
              <Step n={2} title={`Pay the ${SUI.feeSui} SUI process fee`} state={state(2)} summary={`${SUI.feeSui} SUI paid`}>
                {sessionId ? <FeePayment sessionId={sessionId} trackId={track.id} onDone={refresh} /> : null}
              </Step>
            ) : (
              <Step n={2} title={`Stake ${SUI.stakeSui} SUI on this kernel`} state={state(2)} summary={`${SUI.stakeSui} SUI staked`}>
                {sessionId ? <StakePayment sessionId={sessionId} trackId={track.id} onDone={refresh} /> : null}
              </Step>
            )}

            <Step n={3} title="Run it with your agent" state={state(3)}>
              <BuildPicker
                trackId={track.id}
                builds={data?.builds ?? []}
                code={status?.agent?.code ?? "<CODE>"}
              />
            </Step>
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
                  Verifiers get the same output on random inputs, and every run beats the baseline by at least 0.1%
                  and well beyond their noise. 3 of 5 must agree; while the pool is small, the platform harness stands in.
                </dd>
              </div>
            </dl>
          </Card>
        </aside>
      </div>

      <RunningDialog
        row={data?.rows.find((r) => r.id === running) ?? null}
        onClose={() => {
          setRunning(null);
          if (window.location.hash.startsWith("#run_")) history.replaceState(null, "", window.location.pathname);
        }}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */

function FeePayment({ sessionId, trackId, onDone }: { sessionId: string; trackId: string; onDone: () => void }) {
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
      // One approval per submission, backed by your World ID seat (no second check).
      const start = await postJson("/api/approval/start", { sessionId, trackId });
      const started = await start.json();
      if (!start.ok) throw new Error(started.error === "no_seat" ? "Verify with World ID on Get started first." : (started.detail ?? started.error));
      const approvalId = started.approvalId as string;

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
        Verifiers spend real compute re-running your code. The {SUI.feeSui} SUI fee pays them: it&apos;s held in the Opti-om
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

/**
 * The small page that pops up while a submission is being tested: what has
 * happened so far and what is running now, then a simple result card once
 * the verdict lands. OK closes it; the full evidence is under Models.
 */
function RunningDialog({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const decided = row?.status === "verified" || row?.status === "rejected";
  const drawn = !!row && row.verifiers.assigned > 0;
  const ran = !!row && drawn && row.verifiers.revealed >= row.verifiers.assigned;
  const steps: { title: string; text: string; state: "done" | "current" | "todo" | "failed" }[] = row
    ? [
        {
          title: "Uploaded by your agent",
          text: `${row.buildName} · ${row.gpu} · ${row.seconds.toFixed(1)} s there · ${row.buildSha256.slice(0, 12)}…`,
          state: "done",
        },
        {
          title: drawn ? `Verifiers drawn · ${row.verifiers.assigned}` : "Drawing verifiers",
          text: drawn
            ? row.harness
              ? "Too few people in the pool, so the platform harness stands in."
              : "Picked at random from the verifier pool."
            : "Waiting for enough verifiers with matching hardware.",
          state: drawn ? "done" : "current",
        },
        {
          title: "Re-running baseline vs your build",
          text: !drawn
            ? "Starts once verifiers are drawn."
            : ran
              ? "Every verifier has reported."
              : `${row.verifiers.revealed}/${row.verifiers.assigned} reported · seeded runs, baseline and build alternated, outputs compared.`,
          state: !drawn ? "todo" : ran ? "done" : "current",
        },
        {
          title:
            row.status === "verified"
              ? `Verified at ${row.speedup?.toFixed(2)}×`
              : row.status === "rejected"
                ? "Not proven faster"
                : "Verdict",
          text:
            row.status === "verified"
              ? "Same output, clearly faster. It is on the ranking and can be licensed."
              : row.status === "rejected"
                ? "Inside the noise, or a different output. It stays off the ranking."
                : "Decided once the verifiers agree.",
          state: row.status === "verified" ? "done" : row.status === "rejected" ? "failed" : "todo",
        },
      ]
    : [];
  return (
    <Dialog open={!!row} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="border-border bg-card sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {decided ? null : <LoaderIcon className="size-4 animate-spin text-[var(--warning)]" />}
            {decided ? "Your kernel has been tested" : "Your kernel is running"}
          </DialogTitle>
          <DialogDescription>
            {decided ? `${row!.buildName} on ${row!.gpu}` : "Updates live. You can close this and keep working."}
          </DialogDescription>
        </DialogHeader>
        {decided && row ? <ResultCard row={row} /> : null}
        <ol className={`flex flex-col gap-3 ${decided ? "hidden" : ""}`}>
          {steps.map((step) => (
            <li key={step.title} className="flex gap-3">
              <span
                className={`mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full border ${
                  step.state === "done"
                    ? "border-[var(--success)] text-[var(--success)]"
                    : step.state === "current"
                      ? "border-[var(--warning)] text-[var(--warning)]"
                      : step.state === "failed"
                        ? "border-[var(--danger)] text-[var(--danger)]"
                        : "border-border text-muted-foreground"
                }`}
              >
                {step.state === "done" ? (
                  <CheckIcon className="size-3" />
                ) : step.state === "current" ? (
                  <LoaderIcon className="size-3 animate-spin" />
                ) : step.state === "failed" ? (
                  <XIcon className="size-3" />
                ) : null}
              </span>
              <span className="min-w-0">
                <span className={`block text-sm font-medium ${step.state === "todo" ? "text-muted-foreground" : ""}`}>{step.title}</span>
                <span className="block text-xs text-muted-foreground [overflow-wrap:anywhere]">{step.text}</span>
              </span>
            </li>
          ))}
        </ol>
        <div className="mt-2 flex justify-end">
          <Button className="rounded-full px-6" onClick={onClose}>
            OK
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The verdict in a glance: speedup, what it means, who checked it. */
function ResultCard({ row }: { row: Row }) {
  const verified = row.status === "verified";
  const color = verified ? "var(--success)" : "var(--danger)";
  const facts: [string, string][] = [
    ["Verifiers", `${row.verifiers.passed}/${row.verifiers.assigned} passed${row.harness ? " · platform harness" : ""}`],
    ["Your run", `${row.seconds.toFixed(2)} s on ${row.gpu}`],
    ["Code", `${row.buildSha256.slice(0, 16)}…`],
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4 rounded-xl border border-border/60 bg-black/20 p-4">
        <span
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border-2"
          style={{ borderColor: color, color }}
        >
          {verified ? <CheckIcon className="size-5" /> : <XIcon className="size-5" />}
        </span>
        <div className="min-w-0">
          <div className={`leading-none font-medium ${verified ? "vtec-num text-3xl" : "text-2xl"}`} style={{ color }}>
            {verified && row.speedup ? `${row.speedup.toFixed(2)}× faster` : "Not proven faster"}
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {verified
              ? "Same output as the baseline, clearly faster. It is on the ranking and can be licensed."
              : "Inside the noise, or a different output. It stays off the ranking; try another build."}
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
        {facts.map(([k, v]) => (
          <React.Fragment key={k}>
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="[overflow-wrap:anywhere]">{v}</dd>
          </React.Fragment>
        ))}
      </dl>
      {verified ? (
        <p className="micro">The chart, harness conditions and receipts are under Models, whenever you want them.</p>
      ) : null}
    </div>
  );
}

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

/** Without World ID: the stake, sent from Slush to the platform wallet and checked on-chain. */
function StakePayment({ sessionId, trackId, onDone }: { sessionId: string; trackId: string; onDone: () => void }) {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const [busy, setBusy] = React.useState(false);

  const stake = async () => {
    setBusy(true);
    const id = toast.loading("Preparing the stake…");
    try {
      const start = await postJson("/api/stake/start", { sessionId, trackId });
      const started = await start.json();
      if (!start.ok) throw new Error(started.detail ?? started.error);
      if (started.staked) {
        onDone();
        return;
      }
      // Already paid for this approval but the check failed (e.g. timed out):
      // check that same payment again rather than asking for a second one.
      const key = `opti-om.stake.${started.approvalId}`;
      let digest = "";
      try {
        digest = localStorage.getItem(key) ?? "";
      } catch {
        /* no storage: pay as usual */
      }
      if (!digest) {
        toast.loading("Confirm the stake in Slush…", { id });
        const tx = await dAppKit.signAndExecuteTransaction({ transaction: stakeTx(started.to) });
        if (!tx.Transaction) throw new Error(tx.FailedTransaction?.status.error?.message ?? "Transaction failed.");
        digest = tx.Transaction.digest;
        try {
          localStorage.setItem(key, digest);
        } catch {
          /* not fatal */
        }
      }

      toast.loading("Checking the stake on Sui…", { id });
      const check = await postJson("/api/stake/confirm", { approvalId: started.approvalId, sessionId, address: account!.address, digest });
      const result = await check.json();
      if (!check.ok) throw new Error(`${result.detail ?? result.error} Press Stake again to re-check the same payment.`);
      try {
        localStorage.removeItem(key);
      } catch {
        /* not fatal */
      }

      toast.success(`${SUI.stakeSui} SUI staked`, {
        id,
        description: "Returned to this wallet if the kernel verifies.",
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
        No World ID, so your stake is what keeps the pool honest. {SUI.stakeSui} SUI goes to the platform wallet. If
        verifiers find the kernel correct and clearly faster than the baseline (at least 0.1%, and beyond their
        run-to-run noise), it&apos;s published and the stake comes back to this wallet. If not, the stake is slashed.
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

function BuildPicker({
  trackId,
  builds,
  code,
}: {
  trackId: string;
  builds: { folder: string; name: string }[];
  code: string;
}) {
  // "" = let the agent auto-tune a kernel for this GPU (the default).
  const [chosen, setChosen] = React.useState("");
  const origin = useOrigin();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Let your agent tune a kernel for your GPU (it tries random variants, keeps the fastest correct one), or pick a
        build. Either way it&apos;s re-timed against the generic baseline on random inputs by verifiers.
      </p>
      <div className="flex flex-wrap gap-2">
        {[{ folder: "", name: "Auto-tune on my GPU (recommended)" }, ...builds].map((b) => (
          <button
            key={b.folder}
            type="button"
            onClick={() => setChosen(b.folder)}
            className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
              chosen === b.folder ? "border-primary bg-accent/60" : "border-border/70 text-muted-foreground hover:bg-accent/40"
            }`}
          >
            {b.name}
          </button>
        ))}
      </div>
      <CommandBlock>
        bun agent/vtec-agent.ts submit {code} --track {trackId}
        {chosen ? ` --build tracks/${trackId}/${chosen}` : ""}
        {origin ? ` --url ${origin}` : ""}
      </CommandBlock>
      <p className="text-xs text-muted-foreground">
        Your own kernel: put it in a folder with a vtec.json (copy the tuned one) and pass that folder to --build.
      </p>
    </div>
  );
}

export function CommandBlock({ children }: { children: React.ReactNode }) {
  return (
    <code className="vtec-num block overflow-x-auto rounded-lg border border-border/70 bg-black/40 px-4 py-3 text-sm whitespace-nowrap">
      {children}
    </code>
  );
}
