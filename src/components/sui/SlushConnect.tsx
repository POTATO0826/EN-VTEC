"use client";

import * as React from "react";
import { ConnectModal, useCurrentAccount, useDisconnectWallet } from "@mysten/dapp-kit";
import { WalletIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { shortAddress } from "@/lib/sui-tx";

/** Connect Slush (or any Sui wallet). Shows the account once connected. */
export default function SlushConnect({ label = "Connect Slush" }: { label?: string }) {
  const account = useCurrentAccount();
  const { mutate: disconnect } = useDisconnectWallet();
  const [open, setOpen] = React.useState(false);

  if (account) {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-black/30 py-1 pr-1 pl-3 text-sm">
        <span className="size-2 rounded-full bg-[var(--success)]" />
        <span className="vtec-num">{shortAddress(account.address)}</span>
        <Button variant="ghost" size="icon-xs" className="rounded-full" aria-label="Disconnect" onClick={() => disconnect()}>
          <XIcon />
        </Button>
      </span>
    );
  }

  return (
    <ConnectModal
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline" className="w-fit rounded-full">
          <WalletIcon /> {label}
        </Button>
      }
    />
  );
}
