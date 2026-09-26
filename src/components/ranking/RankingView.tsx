"use client";

import * as React from "react";
import Link from "next/link";
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { CheckIcon, DownloadIcon, KeyRoundIcon, ShoppingCartIcon, TrophyIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageTitle } from "@/components/ui/step";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import SlushConnect from "@/components/sui/SlushConnect";
import { postJson } from "@/components/world/WorldIdButton";
import { buyTx, explorerTx, shortAddress, SUI, suiReady } from "@/lib/sui-tx";

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
  harness: boolean;
  tuner: string | null;
  listing: { id: string; digest: string; lineage: string } | null;
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
        subtitle={`Only kernels that verifiers re-ran and confirmed. Buy a license for ${SUI.licenseSui} SUI: 70% goes to the tuner, 20% to the kernel it improved on, 10% to VTEC.`}
      />

      {rows === null ? (
        <div className="h-40 animate-pulse rounded-xl border border-border/60 bg-card/40" />
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-card/40 p-10 text-center">
          <TrophyIcon className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            Nothing verified yet. The first kernel that verifiers confirm takes #1.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Kernel</TableHead>
                <TableHead className="text-right">Speedup</TableHead>
                <TableHead>Verified by</TableHead>
                <TableHead>Tuner</TableHead>
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
                    <Link href={`/tuners/${row.trackId}#${row.id}`} className="block text-sm text-foreground hover:underline">
                      {row.buildName}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {row.track} · <span className="vtec-num">{row.buildSha256.slice(0, 10)}…</span>
                    </span>
                  </TableCell>
                  <TableCell className="vtec-num text-right text-base font-medium text-[var(--success)]">
                    {row.speedup ? `${row.speedup.toFixed(2)}×` : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.verifiers.passed}/{row.verifiers.total} passed
                    {row.harness ? <span className="block text-xs">incl. platform harness</span> : null}
                  </TableCell>
                  <TableCell className="vtec-num text-sm">{row.tuner ? shortAddress(row.tuner) : "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-full"
                      disabled={!row.listing}
                      onClick={() => setSelected(row)}
                    >
                      <ShoppingCartIcon /> {row.listing ? "Get kernel" : "Listing…"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <GetKernelDialog row={selected} onClose={() => setSelected(null)} />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Buy (one PTB: pay + split + License) -> download (sign -> check -> link)   */
/* -------------------------------------------------------------------------- */

function GetKernelDialog({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const [license, setLicense] = React.useState<{ licenseId: string; expiresMs: number } | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [busy, setBusy] = React.useState<"buy" | "download" | null>(null);

  // Does the connected wallet already own a License for this kernel?
  const check = React.useCallback(async () => {
    if (!row || !account) return setLicense(null);
    setChecking(true);
    const res = await fetch(`/api/license/check?address=${account.address}&submission=${row.id}`);
    const data = await res.json().catch(() => ({}));
    setLicense(data.owned ? data.license : null);
    setChecking(false);
  }, [row, account]);
  React.useEffect(() => {
    check();
  }, [check]);

  const buy = async () => {
    if (!row?.listing) return;
    setBusy("buy");
    const id = toast.loading("Confirm the purchase in Slush…");
    try {
      const tx = await dAppKit.signAndExecuteTransaction({ transaction: buyTx(row.listing.id) });
      if (!tx.Transaction) throw new Error(tx.FailedTransaction?.status.error?.message ?? "Transaction failed.");
      const digest = tx.Transaction.digest;
      toast.success("License minted to your wallet", {
        id,
        description: `Paid ${SUI.licenseSui} SUI and split it in the same transaction.`,
        action: { label: "View", onClick: () => window.open(explorerTx(digest), "_blank") },
      });
      // The node may take a moment to index the new object.
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        await check();
      }
    } catch (e) {
      toast.error("Purchase didn't go through", { id, description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const download = async () => {
    if (!row || !account) return;
    setBusy("download");
    const id = toast.loading("Sign the download request in Slush…");
    try {
      const message = `VTEC download ${row.id} at ${Date.now()}`;
      const { signature } = await dAppKit.signPersonalMessage({ message: new TextEncoder().encode(message) });
      toast.loading("Checking your License on Sui…", { id });
      const res = await postJson("/api/license/download", {
        submissionId: row.id,
        address: account.address,
        message,
        signature,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? data.error);
      window.location.href = data.url; // one-use link, valid 2 minutes
      toast.success("Download started", { id, description: "The link worked once and has expired." });
    } catch (e) {
      toast.error("Download refused", { id, description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={!!row} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="border-border bg-card sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{row?.buildName}</DialogTitle>
          <DialogDescription>
            {row?.speedup?.toFixed(2)}× faster on {row?.track}, verified on {row?.verifiers.total} machine
            {row?.verifiers.total === 1 ? "" : "s"}.
          </DialogDescription>
        </DialogHeader>

        {!suiReady() ? (
          <p className="text-sm text-[var(--warning)]">The Sui contract isn&apos;t configured.</p>
        ) : !account ? (
          <SlushConnect label="Connect Slush" />
        ) : (
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border border-border/70 p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <KeyRoundIcon className="size-4" /> 1. License
              </div>
              {checking && !license ? (
                <p className="mt-2 text-sm text-muted-foreground">Checking your wallet…</p>
              ) : license ? (
                <p className="mt-2 flex items-center gap-2 text-sm">
                  <CheckIcon className="size-4 text-[var(--success)]" />
                  You own it until {new Date(license.expiresMs).toLocaleDateString()}. It&apos;s bound to this wallet and
                  can&apos;t be resold.
                </p>
              ) : (
                <>
                  <p className="mt-2 text-sm text-muted-foreground">
                    One transaction: you pay {SUI.licenseSui} SUI, it&apos;s split 70% tuner · 20% lineage · 10% VTEC, and
                    a License object is minted to your wallet.
                  </p>
                  <Button onClick={buy} disabled={!!busy} className="mt-3 rounded-full px-5">
                    {busy === "buy" ? "Buying…" : `Buy for ${SUI.licenseSui} SUI`}
                  </Button>
                </>
              )}
            </div>

            <div className={`rounded-lg border border-border/70 p-4 transition-opacity ${license ? "" : "opacity-50"}`}>
              <div className="flex items-center gap-2 text-sm font-medium">
                <DownloadIcon className="size-4" /> 2. Download
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Sign a message with Slush. VTEC checks the signature and that this wallet owns the License, then gives you
                a link that works once.
              </p>
              <Button
                onClick={download}
                disabled={!license || !!busy}
                variant="outline"
                className="mt-3 rounded-full px-5"
              >
                {busy === "download" ? "Checking…" : "Sign & download"}
              </Button>
            </div>
            <SlushConnect />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
