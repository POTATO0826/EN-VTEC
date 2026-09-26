import { createDAppKit } from "@mysten/dapp-kit-react";
import { SuiGrpcClient } from "@mysten/sui/grpc";

/**
 * Sui wallet connection (Slush). Public fullnodes only speak gRPC now, so
 * this uses the gRPC client. Safe to import on the server: wallet detection
 * only runs in the browser.
 */
const NETWORK = (process.env.NEXT_PUBLIC_SUI_NETWORK ?? "testnet") as "testnet";

export const dAppKit = createDAppKit({
  networks: [NETWORK],
  createClient: (network) => new SuiGrpcClient({ network, baseUrl: `https://fullnode.${network}.sui.io:443` }),
  // The Slush browser extension registers itself. The Slush web wallet needs
  // a deployed https origin, so it's only switched on in production builds.
  slushWalletConfig: process.env.NODE_ENV === "production" ? { appName: "VTEC" } : null,
});

declare module "@mysten/dapp-kit-react" {
  interface Register {
    dAppKit: typeof dAppKit;
  }
}
