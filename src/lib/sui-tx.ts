"use client";

import { Transaction } from "@mysten/sui/transactions";

/** Public Sui config baked in at build time. */
export const SUI = {
  network: process.env.NEXT_PUBLIC_SUI_NETWORK ?? "testnet",
  packageId: process.env.NEXT_PUBLIC_SUI_PACKAGE_ID ?? "",
  vaultId: process.env.NEXT_PUBLIC_SUI_VAULT_ID ?? "",
  marketId: process.env.NEXT_PUBLIC_SUI_MARKET_ID ?? "",
  licenseSui: Number(process.env.NEXT_PUBLIC_LICENSE_SUI ?? "0.1"),
  feeSui: Number(process.env.NEXT_PUBLIC_FEE_SUI ?? "0.01"),
  /** What a tuner without World ID stakes per kernel. */
  stakeSui: Number(process.env.NEXT_PUBLIC_STAKE_SUI ?? "0.0001"),
};

export const suiReady = () => !!(SUI.packageId && SUI.vaultId);

const toMist = (sui: number) => BigInt(Math.round(sui * 1e9));

/**
 * A coin of exactly `sui`, split from the gas coin. Every wallet can sign
 * this. (coinWithBalance would draw on the wallet's address balance instead
 * when it has one, through a FundsWithdrawal input that Slush rejects.)
 */
const pay = (tx: Transaction, sui: number) => tx.splitCoins(tx.gas, [toMist(sui)])[0];
const keyBytes = (id: string) => Array.from(new TextEncoder().encode(id));

/**
 * Pays the process fee for one World ID-approved submission. The payer's
 * HumanPass goes in too: the contract only accepts fees from verified humans.
 */
export function feeTx(approvalId: string, humanPassId: string) {
  const tx = new Transaction();
  const fee = pay(tx, SUI.feeSui);
  tx.moveCall({
    target: `${SUI.packageId}::vault::pay_fee`,
    arguments: [
      tx.object(SUI.vaultId),
      tx.object(humanPassId),
      tx.pure.vector("u8", keyBytes(approvalId)),
      fee,
    ],
  });
  return tx;
}

/**
 * The stake for publishing without World ID: SUI_STAKE from the tuner's
 * wallet to the platform wallet, which returns it if the kernel verifies.
 */
export function stakeTx(to: string) {
  const tx = new Transaction();
  tx.transferObjects([pay(tx, SUI.stakeSui)], to);
  return tx;
}

/**
 * Buys a verified kernel in ONE transaction: pay, split 70/20/10 to tuner,
 * lineage and platform, and mint a non-transferable License to the buyer.
 */
export function buyTx(listingId: string, royaltiesId?: string) {
  const tx = new Transaction();
  const price = pay(tx, SUI.licenseSui);
  tx.moveCall({
    target: `${SUI.packageId}::market::buy`,
    // Listings made by the deployed contract before royalty recovery have no
    // Challenge object, and their buy takes one argument fewer.
    arguments: royaltiesId
      ? [tx.object(listingId), tx.object(SUI.marketId), tx.object(royaltiesId), price, tx.object("0x6")]
      : [tx.object(listingId), tx.object(SUI.marketId), price, tx.object("0x6")],
  });
  return tx;
}

export function explorerTx(digest: string) {
  return `https://suiscan.xyz/${SUI.network}/tx/${digest}`;
}

export function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
