"use client";

import { coinWithBalance, Transaction } from "@mysten/sui/transactions";

/** Public Sui config baked in at build time. */
export const SUI = {
  network: process.env.NEXT_PUBLIC_SUI_NETWORK ?? "testnet",
  packageId: process.env.NEXT_PUBLIC_SUI_PACKAGE_ID ?? "",
  vaultId: process.env.NEXT_PUBLIC_SUI_VAULT_ID ?? "",
  marketId: process.env.NEXT_PUBLIC_SUI_MARKET_ID ?? "",
  licenseSui: Number(process.env.NEXT_PUBLIC_LICENSE_SUI ?? "0.1"),
  feeSui: Number(process.env.NEXT_PUBLIC_FEE_SUI ?? "0.01"),
};

export const suiReady = () => !!(SUI.packageId && SUI.vaultId);

const toMist = (sui: number) => BigInt(Math.round(sui * 1e9));
const keyBytes = (id: string) => Array.from(new TextEncoder().encode(id));

/**
 * Pays the process fee for one World ID-approved submission. The payer's
 * HumanPass goes in too: the contract only accepts fees from verified humans.
 */
export function feeTx(approvalId: string, humanPassId: string) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${SUI.packageId}::vault::pay_fee`,
    arguments: [
      tx.object(SUI.vaultId),
      tx.object(humanPassId),
      tx.pure.vector("u8", keyBytes(approvalId)),
      coinWithBalance({ balance: toMist(SUI.feeSui) }),
    ],
  });
  return tx;
}

/**
 * Buys a verified kernel in ONE transaction: pay, split 70/20/10 to tuner,
 * lineage and platform, and mint a non-transferable License to the buyer.
 */
export function buyTx(listingId: string) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${SUI.packageId}::market::buy`,
    arguments: [
      tx.object(listingId),
      tx.object(SUI.marketId),
      coinWithBalance({ balance: toMist(SUI.licenseSui) }),
      tx.object("0x6"),
    ],
  });
  return tx;
}

export function explorerTx(digest: string) {
  return `https://suiscan.xyz/${SUI.network}/tx/${digest}`;
}

export function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
