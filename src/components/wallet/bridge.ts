"use client";

import * as React from "react";

/**
 * A thin bridge to the wallet connect that already exists in the shell.
 *
 * The registration saga has to be able to open the existing wallet connect and
 * know when it succeeded. It does that through this bridge rather than by
 * forking or restyling the wallet - there is exactly one wallet connect in this
 * app and this is a handle to it, not a second copy.
 */

export type WalletSnapshot = {
  connected: boolean;
  label: string | null;
  chain: string | null;
};

const DISCONNECTED: WalletSnapshot = {
  connected: false,
  label: null,
  chain: null,
};

let snapshot: WalletSnapshot = DISCONNECTED;
let opener: (() => void) | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export const walletBridge = {
  /** Called by the shell that owns the wallet UI. */
  register(open: () => void) {
    opener = open;
  },
  unregister() {
    opener = null;
  },
  /** Opens the existing connect flow. Never renders a second one. */
  open() {
    opener?.();
  },
  available() {
    return opener !== null;
  },
  setConnected(label: string, chain: string) {
    snapshot = { connected: true, label, chain };
    emit();
  },
  setDisconnected() {
    snapshot = DISCONNECTED;
    emit();
  },
  getSnapshot(): WalletSnapshot {
    return snapshot;
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useWallet(): WalletSnapshot {
  return React.useSyncExternalStore(
    walletBridge.subscribe,
    walletBridge.getSnapshot,
    () => DISCONNECTED,
  );
}
