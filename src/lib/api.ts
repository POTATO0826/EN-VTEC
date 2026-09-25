"use client";

/**
 * The browser's view of the backend.
 *
 * Everything here degrades to null rather than throwing. The dashboard has
 * always worked with no API, no chain and no GPU, and that stays true: when the
 * services are not running the pages render their fixtures and say so. What must
 * never happen is fixture data presented as though it came from the chain, so
 * `useSystemStatus` returns an explicit `source` and the UI keys off that.
 */

import * as React from "react";

const API_URL = process.env.NEXT_PUBLIC_GPUVTEC_API ?? "http://127.0.0.1:8787";
const BRIDGE_URL = process.env.NEXT_PUBLIC_GPUVTEC_BRIDGE ?? "http://127.0.0.1:8788";

export type ApiHealth = {
  ok: boolean;
  chainId: number;
  registry: string;
  rpcUrl: string;
  canRelay: boolean;
};

export type BridgeHealth = {
  ok: boolean;
  signer: string;
  mode: "world" | "dev-stub" | "blocked";
  worldConfigured: boolean;
  devAttest: boolean;
  missingEnv?: string[];
  warning: string | null;
};

export type ReleaseView = {
  releaseId: string;
  projectId: string;
  channelHash: string;
  candidateId: string;
  reportHash: string;
  previousReleaseId: string;
  authorityDigest: string;
  status: number;
  statusName: "none" | "active" | "revoked";
};

export type SystemStatus = {
  /** "live" when the API answered; "fixtures" when it did not. */
  source: "live" | "fixtures";
  api: ApiHealth | null;
  bridge: BridgeHealth | null;
  release: ReleaseView | null;
  checkedAt: Date | null;
};

async function getJson<T>(url: string, signal: AbortSignal): Promise<T | null> {
  try {
    const response = await fetch(url, { signal, cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    // Offline, CORS, service down, or the tab was backgrounded mid-request.
    return null;
  }
}

/**
 * Polls the services.
 *
 * Deliberately not an EventSource: there is nothing to stream here, and a
 * long-lived connection is one more thing to re-establish every time the laptop
 * wakes. A short poll that re-runs on focus is both simpler and more robust.
 */
export function useSystemStatus(intervalMs = 10_000): SystemStatus {
  const [status, setStatus] = React.useState<SystemStatus>({
    source: "fixtures",
    api: null,
    bridge: null,
    release: null,
    checkedAt: null,
  });

  React.useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    const check = async () => {
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;

      const [api, bridge] = await Promise.all([
        getJson<ApiHealth>(`${API_URL}/health`, signal),
        getJson<BridgeHealth>(`${BRIDGE_URL}/health`, signal),
      ]);

      let release: ReleaseView | null = null;
      if (api) {
        const projectId = process.env.NEXT_PUBLIC_GPUVTEC_PROJECT_ID;
        if (projectId) {
          release = await getJson<ReleaseView>(
            `${API_URL}/projects/${projectId}/release?channel=stable`,
            signal,
          );
        }
      }

      if (cancelled) return;
      setStatus({
        source: api ? "live" : "fixtures",
        api,
        bridge,
        release,
        checkedAt: new Date(),
      });
      timer = setTimeout(check, intervalMs);
    };

    void check();

    // A laptop that sleeps stops timers. Re-check the moment the tab is looked
    // at again, so the first thing a returning user sees is current.
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);

    return () => {
      cancelled = true;
      controller?.abort();
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [intervalMs]);

  return status;
}

export { API_URL, BRIDGE_URL };
