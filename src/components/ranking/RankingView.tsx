"use client";

import * as React from "react";
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { zipSync } from "fflate";
import { CheckIcon, DownloadIcon, ScanFaceIcon, TrophyIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageTitle } from "@/components/ui/step";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import SlushConnect from "@/components/sui/SlushConnect";
import { postJson } from "@/components/world/WorldIdButton";
import { explorerTx, royaltyTx, shortAddress, SUI, suiReady } from "@/lib/sui-tx";

type Row = {
  rank: number;
  id: string;
  track: string;
  trackId: string;
  buildName: string;
  buildSha256: string;
  gpu: string;
  speedup: number | null;
  verifiers: { passed: number; total: number };
  humanTuner: boolean;
  payout: string | null;
  royalties: { count: number; mist: string };
  drawSource: string | null;
};

export default function RankingView() {
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [selected, setSelected] = React.useState<Row | null>(null);

  const refresh = React.useCallback(async () => {
    const res = await fetch("/api/ranking", { cache: "no-store" });
    if (res.ok) setRows((await res.json()).rows);
  }, []);
  React.useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  return (
    <>
      <PageTitle
        title="Kernel Code Efficiency Ranking"
        subtitle="Only code that independent verifiers re-ran and agreed on. Use it for a small royalty that goes straight to the tuner."
      />

      {rows === null ? (
        <div className="h-40 animate-pulse rounded-xl border border-border/60 bg-card/40" />
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-card/40 p-10 text-center">
          <TrophyIcon className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            Nothing verified yet. The first build that 3 of 5 verifiers agree on takes #1.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Build</TableHead>
                <TableHead className="text-right">Speedup</TableHead>
                <TableHead>Verified by</TableHead>
                <TableHead>Tuner</TableHead>
                <TableHead className="text-right">Royalties</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => (
                <TableRow
                  key={row.id}
                  className="animate-in fade-in slide-in-from-bottom-1 fill-mode-both duration-300"
                  style={{ animationDelay: `${i * 50}ms` }}
                >
                  <TableCell className="vtec-num">{row.rank}</TableCell>
                  <TableCell>
                    <span className="block text-sm">{row.buildName}</span>
                    <span className="text-xs text-muted-foreground">
                      {row.track} · <span className="vtec-num">{row.buildSha256.slice(0, 10)}…</span>
                    </span>
                  </TableCell>
                  <TableCell className="vtec-num text-right text-base font-medium text-[var(--success)]">
                    {row.speedup ? `${row.speedup.toFixed(2)}×` : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.verifiers.passed}/{row.verifiers.total} verifiers
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5 text-sm">
                      {row.humanTuner ? <ScanFaceIcon className="size-3.5 text-[var(--success)]" /> : null}
                      {row.payout ? <span className="vtec-num">{shortAddress(row.payout)}</span> : "—"}
                    </span>
                  </TableCell>
                  <TableCell className="vtec-num text-right text-sm">
                    {(Number(row.royalties.mist) / 1e9).toFixed(2)} SUI
                    <span className="block text-xs text-muted-foreground">{row.royalties.count} uses</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" className="rounded-full" onClick={() => setSelected(row)}>
                      <DownloadIcon /> Get code
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <GetCodeDialog row={selected} onClose={() => setSelected(null)} onPaid={refresh} />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Get code: subscribe with ENSv2 (preview) -> pay royalty in SUI -> download  */
/* -------------------------------------------------------------------------- */

const ENS_KEY = "vtec.ens";

function useEnsSubscription() {
  const [name, setName] = React.useState<string | null>(null);
  React.useEffect(() => {
    try {
      setName(localStorage.getItem(ENS_KEY));
    } catch {
      /* not fatal */
    }
  }, []);
  const subscribe = (label: string) => {
    const full = `${label}.vtec.eth`;
    try {
      localStorage.setItem(ENS_KEY, full);
    } catch {
      /* not fatal */
    }
    setName(full);
  };
  return { name, subscribe };
}

function GetCodeDialog({ row, onClose, onPaid }: { row: Row | null; onClose: () => void; onPaid: () => void }) {
  const ens = useEnsSubscription();
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const [label, setLabel] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const pay = async () => {
    if (!row?.payout) return;
    setBusy(true);
    const id = toast.loading("Confirm the royalty in Slush…");
    try {
      const result = await dAppKit.signAndExecuteTransaction({ transaction: royaltyTx(row.id, row.payout) });
      if (!result.Transaction) throw new Error(result.FailedTransaction?.status.error?.message ?? "Transaction failed.");
      const digest = result.Transaction.digest;
      toast.loading("Checking the payment on Sui…", { id });
      const res = await postJson("/api/royalty", { submissionId: row.id, digest });
      const bundle = await res.json();
      if (!res.ok) throw new Error(bundle.detail ?? bundle.error);

      // Zip the exact verified files and hand them over.
      const files: Record<string, Uint8Array> = {};
      for (const [name, b64] of Object.entries(bundle.files as Record<string, string>)) {
        files[name] = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      }
      const blob = new Blob([zipSync(files)], { type: "application/zip" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${row.trackId}-${row.buildSha256.slice(0, 8)}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);

      toast.success(`Paid ${SUI.royaltySui} SUI to the tuner`, {
        id,
        description: "Your download has started.",
        action: { label: "View", onClick: () => window.open(explorerTx(digest), "_blank") },
      });
      onPaid();
      onClose();
    } catch (e) {
      toast.error("Payment didn't go through", { id, description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!row} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="border-border bg-card sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Get {row?.buildName}</DialogTitle>
          <DialogDescription>
            {row?.speedup?.toFixed(2)}× faster on {row?.track}, verified by {row?.verifiers.passed} people.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* 1. ENSv2 subscription (preview) */}
          <div className="rounded-lg border border-border/70 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">1. Subscribe with ENSv2</p>
              <Badge variant="outline" className="font-normal text-muted-foreground">
                preview
              </Badge>
            </div>
            {ens.name ? (
              <p className="mt-2 flex items-center gap-2 text-sm">
                <CheckIcon className="size-4 text-[var(--success)]" />
                <span className="vtec-num">{ens.name}</span>
              </p>
            ) : (
              <form
                className="mt-3 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (label) ens.subscribe(label.toLowerCase().replace(/[^a-z0-9-]/g, ""));
                }}
              >
                <div className="flex flex-1 items-center rounded-md border border-input bg-black/30 px-3 text-sm">
                  <input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="yourname"
                    className="w-full bg-transparent py-2 outline-none"
                  />
                  <span className="vtec-num text-muted-foreground">.vtec.eth</span>
                </div>
                <Button type="submit" size="sm" className="h-auto rounded-md">
                  Subscribe
                </Button>
              </form>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              A subname on ENSv2 (Sepolia) will be your VTEC membership. This step is a preview and isn&apos;t on-chain yet.
            </p>
          </div>

          {/* 2. Royalty */}
          <div className={`rounded-lg border border-border/70 p-4 transition-opacity ${ens.name ? "" : "pointer-events-none opacity-50"}`}>
            <p className="text-sm font-medium">2. Pay the tuner {SUI.royaltySui} SUI</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Goes straight to {row?.payout ? shortAddress(row.payout) : "the tuner"} on Sui, then the exact verified code
              downloads as a zip.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {!suiReady() ? (
                <p className="text-sm text-[var(--warning)]">Sui contract not configured.</p>
              ) : !row?.payout ? (
                <p className="text-sm text-muted-foreground">This tuner hasn&apos;t set a payout address yet.</p>
              ) : account ? (
                <>
                  <Button onClick={pay} disabled={busy} className="rounded-full px-5">
                    {busy ? "Paying…" : `Pay ${SUI.royaltySui} SUI & download`}
                  </Button>
                  <SlushConnect />
                </>
              ) : (
                <SlushConnect label="Connect Slush to pay" />
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
