import {
  createPublicClient,
  custom,
  formatEther,
  numberToHex,
  type Address,
  type Chain,
} from "viem";
import { base, mainnet, sepolia, worldchainSepolia } from "viem/chains";

/**
 * Real MetaMask, straight through window.ethereum (EIP-1193). No wallet kit:
 * the header only needs connect, switch network, and read a balance.
 */

export const CHAINS = {
  Sepolia: sepolia,
  "World Chain Sepolia": worldchainSepolia,
  Base: base,
  Ethereum: mainnet,
} as const satisfies Record<string, Chain>;

export type ChainName = keyof typeof CHAINS;

export const DEFAULT_CHAIN: ChainName = "Sepolia";

type Eip1193 = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
  isMetaMask?: boolean;
};

export function getProvider(): Eip1193 | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { ethereum?: Eip1193 }).ethereum ?? null;
}

export function chainNameFor(chainId: number): ChainName | null {
  const entry = Object.entries(CHAINS).find(([, chain]) => chain.id === chainId);
  return entry ? (entry[0] as ChainName) : null;
}

export async function requestAccount(): Promise<Address> {
  const provider = getProvider();
  if (!provider) throw new Error("MetaMask not found. Install it, then reload.");
  const accounts = (await provider.request({
    method: "eth_requestAccounts",
  })) as Address[];
  if (!accounts[0]) throw new Error("MetaMask returned no account.");
  return accounts[0];
}

export async function currentChainId(): Promise<number> {
  const provider = getProvider();
  if (!provider) throw new Error("MetaMask not found.");
  return Number(await provider.request({ method: "eth_chainId" }));
}

/** Switches MetaMask to the chain, adding it first if MetaMask doesn't know it. */
export async function switchChain(name: ChainName) {
  const provider = getProvider();
  if (!provider) throw new Error("MetaMask not found.");
  const chain = CHAINS[name];
  const chainId = numberToHex(chain.id);
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId }],
    });
  } catch (error) {
    // 4902: unknown chain. Anything else (user said no) is passed on.
    if ((error as { code?: number }).code !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId,
          chainName: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: chain.rpcUrls.default.http,
          blockExplorerUrls: chain.blockExplorers
            ? [chain.blockExplorers.default.url]
            : [],
        },
      ],
    });
  }
}

export async function getBalance(address: Address): Promise<string> {
  const provider = getProvider();
  if (!provider) return "0";
  const client = createPublicClient({ transport: custom(provider) });
  const wei = await client.getBalance({ address });
  return Number(formatEther(wei)).toFixed(3);
}

export function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
