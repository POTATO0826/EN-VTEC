"use client";

import { coinWithBalance, Transaction } from "@mysten/sui/transactions";

/** Public Sui config baked in at build time. */
export const SUI = {
  network: process.env.NEXT_PUBLIC_SUI_NETWORK ?? "testnet",
  packageId: process.env.NEXT_PUBLIC_SUI_PACKAGE_ID ?? "",
  vaultId: process.env.NEXT_PUBLIC_SUI_VAULT_ID ?? "",
  stakeSui: Number(process.env.NEXT_PUBLIC_STAKE_SUI ?? "1"),
  royaltySui: Number(process.env.NEXT_PUBLIC_ROYALTY_SUI ?? "0.1"),
};

export const suiReady = () => !!(SUI.packageId && SUI.vaultId);

const toMist = (sui: number) => BigInt(Math.round(sui * 1e9));
const keyBytes = (id: string) => Array.from(new TextEncoder().encode(id));

/** Locks the stake for one approval in the vault. */
export function stakeTx(approvalId: string) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${SUI.packageId}::vault::stake`,
    arguments: [
      tx.object(SUI.vaultId),
      tx.pure.vector("u8", keyBytes(approvalId)),
      coinWithBalance({ balance: toMist(SUI.stakeSui) }),
    ],
  });
  return tx;
}

/** Pays a tuner's royalty for one verified submission. */
export function royaltyTx(submissionId: string, tuner: string) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${SUI.packageId}::vault::pay_royalty`,
    arguments: [
      tx.pure.vector("u8", keyBytes(submissionId)),
      tx.pure.address(tuner),
      coinWithBalance({ balance: toMist(SUI.royaltySui) }),
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
