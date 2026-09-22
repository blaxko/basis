"use client";

import { useCallback, useEffect, useState } from "react";

export interface PollState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refetch: () => void;
}

// Polls a same-origin API route on an interval, and exposes a manual
// refetch — the killswitch control uses that to re-pull server state
// right after a POST, rather than trusting an optimistic local update.
export function usePoll<T>(url: string, intervalMs: number): PollState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchOnce = useCallback(async () => {
    try {
      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const message = json && typeof json.error === "string" ? json.error : `${url} returned ${res.status}`;
        throw new Error(message);
      }
      setData(json as T);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "request failed");
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    fetchOnce();
    if (intervalMs <= 0) return;
    const id = setInterval(fetchOnce, intervalMs);
    return () => clearInterval(id);
  }, [fetchOnce, intervalMs]);

  return { data, error, loading, refetch: fetchOnce };
}
