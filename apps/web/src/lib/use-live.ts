'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { QueueEventName } from '@queueos/core';
import { REFRESH_EVENTS, useRealtime } from './use-realtime';

interface Subscription {
  branchId?: string;
  queueIds?: string[];
  tokenIds?: string[];
}

/**
 * Fetch once, then refetch whenever the server says something changed.
 *
 * Every screen in the product shows the same underlying queue state, so they
 * all want the same behaviour: load, subscribe, re-read on relevant events.
 * Bursts are coalesced because a single NEXT press emits three events
 * (CounterAssigned, ServiceStarted, ETAUpdated) and refetching three times
 * would make the numbers visibly stutter.
 */
export function useLive<T>(
  /** Changes to this string trigger a fresh load — usually the resource id. */
  key: string,
  load: () => Promise<T>,
  subscription: Subscription,
  options: { events?: QueueEventName[]; pollMs?: number } = {},
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadRef = useRef(load);
  loadRef.current = load;
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      const next = await loadRef.current();
      setData(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, []);

  const schedule = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(refresh, 150);
  }, [refresh]);

  useEffect(() => {
    setLoading(true);
    refresh();
    return () => clearTimeout(timerRef.current);
  }, [key, refresh]);

  // A slow poll as a safety net. Sockets drop on flaky venue wifi and a stale
  // "Now Serving" board is worse than a slightly late one.
  const pollMs = options.pollMs ?? 30_000;
  useEffect(() => {
    const id = setInterval(refresh, pollMs);
    return () => clearInterval(id);
  }, [refresh, pollMs]);

  const watched = options.events ?? REFRESH_EVENTS;
  const { connected } = useRealtime(subscription, (event) => {
    if (watched.includes(event.name)) schedule();
  });

  return { data, error, loading, live: connected, refresh };
}
