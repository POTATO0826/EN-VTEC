/**
 * Configuration, read once at boot.
 *
 * Build plan section 0 rule 4: "Keep secrets server-side. Identity tokens,
 * signing keys, and API keys never reach the frontend, the agent workspace, or
 * logs." Nothing in here is ever serialised into a response; `publicConfig()`
 * below is the only thing the browser sees, and it is a deliberate allow-list.
 */

import type { Address, Hex } from "viem";

function env(name: string, fallback?: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing required env ${name}`);
  }
  return value;
}

function optional(name: string): string | null {
  const value = process.env[name];
  return value === undefined || value === "" ? null : value;
}

export type ApiConfig = {
  port: number;
  databasePath: string;
  rpcUrl: string;
  chainId: number;
  registry: Address;
  relayerKey: Hex | null;
  bridgeUrl: string;
  /** Where the browser is, for CORS. */
  webOrigin: string;
};

export function loadConfig(): ApiConfig {
  return {
    port: Number(env("GPUVTEC_API_PORT", "8787")),
    databasePath: env("GPUVTEC_DB", ".data/api.sqlite"),
    rpcUrl: env("GPUVTEC_RPC_URL", "http://127.0.0.1:8545"),
    chainId: Number(env("GPUVTEC_CHAIN_ID", "31337")),
    registry: env("GPUVTEC_REGISTRY", "0x5FbDB2315678afecb367f032d93F642f64180aa3") as Address,
    relayerKey: optional("GPUVTEC_RELAYER_KEY") as Hex | null,
    bridgeUrl: env("GPUVTEC_BRIDGE_URL", "http://127.0.0.1:8788"),
    webOrigin: env("GPUVTEC_WEB_ORIGIN", "http://127.0.0.1:3000"),
  };
}

/** The allow-list. If a field is not named here the browser does not get it. */
export function publicConfig(config: ApiConfig) {
  return {
    chainId: config.chainId,
    registry: config.registry,
    rpcUrl: config.rpcUrl,
    /** Whether this API can pay gas at all. Not the key, just the fact. */
    canRelay: config.relayerKey !== null,
  };
}
