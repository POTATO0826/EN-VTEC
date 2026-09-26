"use client";

import * as React from "react";

/**
 * An anonymous id for this browser. It is the IDKit signal, so a World ID
 * proof is bound to this session, and the local agent pairs against it.
 */
const KEY = "vtec.session";

function create() {
  return `s_${crypto.randomUUID().replace(/-/g, "")}`;
}

export function useSessionId(): string | null {
  const [id, setId] = React.useState<string | null>(null);
  React.useEffect(() => {
    let value: string | null = null;
    try {
      value = localStorage.getItem(KEY);
      if (!value) {
        value = create();
        localStorage.setItem(KEY, value);
      }
    } catch {
      value = create();
    }
    setId(value);
  }, []);
  return id;
}

export type SessionStatus = {
  seat: { nullifier: string; at: string } | null;
  agent: {
    code: string;
    hostname: string;
    os: string;
    cpu: string;
    gpus: { name: string; memoryMb: number | null; driver: string | null }[];
    lastSeen: string;
  } | null;
};

/** Polls the server for seat + agent state. */
export function useSessionStatus(sessionId: string | null, intervalMs = 3000) {
  const [status, setStatus] = React.useState<SessionStatus | null>(null);
  const refresh = React.useCallback(async () => {
    if (!sessionId) return;
    const res = await fetch(`/api/session?id=${sessionId}`, { cache: "no-store" });
    if (res.ok) setStatus((await res.json()) as SessionStatus);
  }, [sessionId]);

  React.useEffect(() => {
    refresh();
    const timer = setInterval(refresh, intervalMs);
    return () => clearInterval(timer);
  }, [refresh, intervalMs]);

  return { status, refresh };
}
