'use client';
// Polling, and the live-order hooks built on it.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Order } from '../orders';
import { api } from './api';
import { ApiError } from './http';

// Runs `fn` now and then every `ms`, one call at a time. It pauses while the page is hidden (a
// sleeping tablet or a phone in a pocket makes no requests) and catches up at once when it shows
// again or the device comes back online. After a failure it waits longer, up to MAX_BACKOFF_MS.
// `fn` returns false (or throws) to report a failed attempt. Returns a function that polls right now.
const MAX_BACKOFF_MS = 4000;
export function usePoll(fn: () => Promise<boolean | void>, ms: number, on = true) {
  const latest = useRef(fn);
  latest.current = fn;
  const kick = useRef<() => void>(() => {});
  useEffect(() => {
    if (!on) return;
    let stop = false,
      timer: ReturnType<typeof setTimeout> | undefined,
      running = false,
      again = false,
      fails = 0;
    const run = async () => {
      if (stop) return;
      if (running) {
        again = true;
        return;
      } // asked while busy: go once more straight after
      clearTimeout(timer);
      if (document.hidden) return; // visibilitychange restarts it
      running = true;
      let ok = true;
      try {
        ok = (await latest.current()) !== false;
      } catch {
        ok = false;
      }
      running = false;
      fails = ok ? 0 : fails + 1;
      if (again && !stop) {
        again = false;
        run();
        return;
      }
      // fast polls back off up to MAX_BACKOFF_MS; slow ones retry sooner than their interval (15 s at most)
      const retry = Math.min(ms * 2 ** fails, ms > MAX_BACKOFF_MS ? Math.min(ms, 15_000) : MAX_BACKOFF_MS);
      if (!stop) timer = setTimeout(run, ok ? ms : retry);
    };
    const wake = () => {
      if (!document.hidden) run();
    };
    kick.current = run;
    run();
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    return () => {
      stop = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
    };
  }, [ms, on]);
  return useCallback(() => kick.current(), []);
}

// Live orders for the kitchen, TV and dashboard. Polling (1.5 s) instead of Supabase Realtime: simple,
// and fast enough for a few devices; `online` turns false after a failed fetch so screens can show it.
export function useLiveOrders(intervalMs = 1500) {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [online, setOnline] = useState(true);
  const localAt = useRef(0);
  const refresh = usePoll(async () => {
    const started = Date.now();
    try {
      const data = await api.live();
      // A poll that began before the latest tap on this screen carries stale state; dropping it
      // stops the order from flickering back (and replaying its animation) after a tap.
      if (started >= localAt.current) setOrders(data);
      setOnline(true);
    } catch {
      setOnline(false);
      return false;
    }
  }, intervalMs);
  const noteLocalChange = useCallback(() => {
    localAt.current = Date.now();
  }, []);
  return { orders, setOrders, online, refresh, noteLocalChange };
}

// Today's orders, newest first, for the history views. Polls only while `on` (e.g. the panel is open).
export function useTodayOrders(on: boolean, intervalMs = 10_000) {
  const [orders, setOrders] = useState<Order[] | null>(null);
  usePoll(
    async () => {
      setOrders(await api.today());
    },
    intervalMs,
    on,
  );
  return orders;
}

// The TV's "Collected" row: the last few collected order numbers, nothing else.
export function useCollected(intervalMs = 10_000) {
  const [list, setList] = useState<{ id: string; token: string }[]>([]);
  usePoll(async () => {
    setList(await api.collected());
  }, intervalMs);
  return list;
}

// One order, polled. `missing` turns true when the server says it doesn't exist (a mistyped bill link);
// network errors keep the last known order instead.
export function useOrder(id: string | null, intervalMs = 1500) {
  return useOrderState(id, intervalMs).order;
}

export function useOrderState(id: string | null, intervalMs = 1500) {
  const [order, setOrder] = useState<Order | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    setOrder(null);
    setMissing(false);
  }, [id]);
  usePoll(
    async () => {
      try {
        setOrder(await api.order(id!));
        setMissing(false);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          setMissing(true);
          return;
        }
        return false;
      }
    },
    intervalMs,
    !!id,
  );
  return { order, missing };
}

// Ids that appeared for the first time within the last `ms`. Used so entrance animations play once
// per order, not again whenever a list re-sorts and React moves the card.
export function useFreshIds(ids: string[], ms = 1500): Set<string> {
  const firstSeen = useRef(new Map<string, number>());
  const [, tick] = useState(0);
  const now = Date.now();
  for (const id of ids) if (!firstSeen.current.has(id)) firstSeen.current.set(id, now);
  const fresh = new Set(ids.filter((id) => now - firstSeen.current.get(id)! < ms));
  useEffect(() => {
    if (!fresh.size) return;
    const t = setTimeout(() => tick((n) => n + 1), ms);
    return () => clearTimeout(t);
  });
  return fresh;
}
