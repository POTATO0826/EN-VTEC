"use client";

import * as React from "react";
import { DAppKitProvider } from "@mysten/dapp-kit-react";
import { Toaster } from "sonner";
import { dAppKit } from "@/lib/dapp-kit";

/** Sui wallet (Slush) + toasts, for every page. */
export default function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <DAppKitProvider dAppKit={dAppKit}>
      {children}
      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{ className: "!bg-card !border-border !text-foreground" }}
      />
    </DAppKitProvider>
  );
}
