"use client";

import { useCallback, useEffect, useState } from "react";
import { pollErrorMessage } from "./poll-error";

export interface PollState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refetch: () => void;
}

// Panels that poll the same route at the same moment (the spread monitor
// and the gate both read /api/opportunities; the gate and the ledger both
// read /api/ledger) share one request instead of each making its own.
type Reply = { ok: boolean; status: number; json: unknown };
const inflight = new Map<string, Promise<Reply>>();

function get(url: string, fresh: boolean): Promise<Reply> {
  const shared = fresh ? undefined : inflight.get(url);
  if (shared) return shared;
  const request = fetch(url, { cache: "no-store" })
    .then(async (res) => ({ ok: res.ok, status: res.status, json: await res.json().catch(() => null) }))
    .finally(() => {
      if (inflight.get(url) === request) inflight.delete(url);
    });
  inflight.set(url, request);
  return request;
}

// Polls a same-origin API route on an interval, and exposes a manual
// refetch — the killswitch control uses that to re-pull server state
// right after a POST, rather than trusting an optimistic local update.
// A refetch always makes its own request, so it never reuses a reply that
// was already on its way before the POST.
export function usePoll<T>(url: string, intervalMs: number): PollState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchOnce = useCallback(
    async (fresh = false) => {
      try {
        const reply = await get(url, fresh);
        if (!reply.ok) {
          setError(pollErrorMessage(reply.status, reply.json));
          return;
        }
        setData(reply.json as T);
        setError(null);
      } catch {
        // Network failure in the browser; its own text isn't shown.
        setError("couldn't reach the server");
      } finally {
        setLoading(false);
      }
    },
    [url]
  );

  useEffect(() => {
    fetchOnce();
    if (intervalMs <= 0) return;
    const id = setInterval(() => fetchOnce(), intervalMs);
    return () => clearInterval(id);
  }, [fetchOnce, intervalMs]);

  const refetch = useCallback(() => {
    void fetchOnce(true);
  }, [fetchOnce]);

  return { data, error, loading, refetch };
}
