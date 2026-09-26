"use client";

import * as React from "react";
import { createNetworkConfig, SuiClientProvider, WalletProvider } from "@mysten/dapp-kit";
import { getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";

const { networkConfig } = createNetworkConfig({
  testnet: { network: "testnet", url: getJsonRpcFullnodeUrl("testnet") },
  devnet: { network: "devnet", url: getJsonRpcFullnodeUrl("devnet") },
});

const NETWORK = (process.env.NEXT_PUBLIC_SUI_NETWORK ?? "testnet") as "testnet" | "devnet";

/** Sui wallet (Slush) + data fetching + toasts, for every page. */
export default function AppProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networkConfig} defaultNetwork={NETWORK}>
        {/* Slush browser extension registers itself; the Slush web wallet needs a
            deployed https origin, so it is off for local dev. */}
        <WalletProvider autoConnect preferredWallets={["Slush"]}>
          {children}
          <Toaster
            theme="dark"
            position="bottom-right"
            toastOptions={{ className: "!bg-card !border-border !text-foreground" }}
          />
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  );
}
