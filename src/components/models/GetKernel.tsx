"use client";

import * as React from "react";
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { CheckIcon, DownloadIcon, KeyRoundIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import SlushConnect from "@/components/sui/SlushConnect";
import { postJson } from "@/components/world/WorldIdButton";
import { buyTx, explorerTx, SUI, suiReady } from "@/lib/sui-tx";

export type Purchasable = {
  id: string;
  name: string;
  track: string;
  speedup: number | null;
  verifiers: { total: number };
  listing: { id: string } | null;
};

/* Buy (one PTB: pay + split + License) -> download (sign -> check -> link). */
export default function GetKernelDialog({ row, onClose }: { row: Purchasable | null; onClose: () => void }) {
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
          <DialogTitle>{row?.name}</DialogTitle>
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
