"use client";

import * as React from "react";
import { useCurrentAccount, useDAppKit, useWallets } from "@mysten/dapp-kit-react";
import { ExternalLinkIcon, WalletIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { shortAddress } from "@/lib/sui-tx";

/** Connect Slush (or any Sui wallet). Shows the account once connected. */
export default function SlushConnect({ label = "Connect Slush" }: { label?: string }) {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const wallets = useWallets();
  const [open, setOpen] = React.useState(false);
  const [connecting, setConnecting] = React.useState<string | null>(null);

  // Slush first, then anything else that speaks the Sui wallet standard.
  const sorted = [...wallets].sort((a, b) => Number(/slush/i.test(b.name)) - Number(/slush/i.test(a.name)));

  if (account) {
    return (
      <span className="inline-flex w-fit items-center gap-2 rounded-full border border-border/70 bg-black/30 py-1 pr-1 pl-3 text-sm animate-in fade-in">
        <span className="size-2 rounded-full bg-[var(--success)]" />
        <span className="vtec-num">{shortAddress(account.address)}</span>
        <Button
          variant="ghost"
          size="icon-xs"
          className="rounded-full"
          aria-label="Disconnect"
          onClick={() => dAppKit.disconnectWallet()}
        >
          <XIcon />
        </Button>
      </span>
    );
  }

  return (
    <>
      <Button variant="outline" className="w-fit rounded-full" onClick={() => setOpen(true)}>
        <WalletIcon /> {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="border-border bg-card sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Connect a Sui wallet</DialogTitle>
            <DialogDescription>Use Slush on Sui testnet.</DialogDescription>
          </DialogHeader>
          {sorted.length === 0 ? (
            <div className="flex flex-col gap-3 text-sm text-muted-foreground">
              <p>No Sui wallet found in this browser.</p>
              <a
                href="https://slush.app"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-foreground underline-offset-4 hover:underline"
              >
                Install the Slush extension <ExternalLinkIcon className="size-3.5" />
              </a>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {sorted.map((wallet) => (
                <button
                  key={wallet.name}
                  type="button"
                  disabled={!!connecting}
                  onClick={async () => {
                    setConnecting(wallet.name);
                    try {
                      await dAppKit.connectWallet({ wallet });
                      setOpen(false);
                      toast.success(`Connected ${wallet.name}`);
                    } catch (e) {
                      toast.error("Couldn't connect", { description: e instanceof Error ? e.message : String(e) });
                    } finally {
                      setConnecting(null);
                    }
                  }}
                  className="flex items-center gap-3 rounded-lg border border-border/70 p-3 text-left transition-colors hover:bg-accent/40 disabled:opacity-60"
                >
                  {wallet.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={wallet.icon} alt="" className="size-7 rounded-md" />
                  ) : (
                    <WalletIcon className="size-5" />
                  )}
                  <span className="flex-1 text-sm font-medium">{wallet.name}</span>
                  {connecting === wallet.name ? (
                    <span className="text-xs text-muted-foreground">Check your wallet…</span>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
