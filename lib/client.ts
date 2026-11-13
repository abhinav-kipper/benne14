'use client';
// Browser-side API calls and live-order hooks for the kiosk, kitchen, board and phone bill.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Customer, DiscountCode, DiscountRule, KioskSettings } from './discounts';
import type { CartLine } from './pricing';
import type { Overrides } from './menu';
import type { AdminEvent, Order, OrderStatus, OrderType, PayMethod } from './orders';
import type { Summary } from './reports';
import { BUILD_ID } from './version';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    ...init,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError((body as { error?: string }).error ?? `HTTP ${r.status}`, r.status);
  return body as T;
}

export const api = {
  placeOrder: (b: {
    key: string;
    type: OrderType;
    name: string | null;
    payMethod: PayMethod;
    lines: CartLine[];
    code?: string | null;
    phone?: string | null;
    expectTotal?: number; // the total the customer was shown; the server refuses if its own differs
  }) => call<Order>('/api/orders', { method: 'POST', body: JSON.stringify(b) }),
  // What the cart asks for (the owner's switches), and whether a code works for this cart.
  kiosk: () => call<KioskSettings>('/api/kiosk'),
  checkCode: (code: string, lines: CartLine[]) =>
    call<{ rule: DiscountRule; amount: number; short: number }>('/api/discounts/check', {
      method: 'POST',
      body: JSON.stringify({ code, lines }),
    }),
  order: (id: string) => call<Order>(`/api/orders/${id}`),
  live: () => call<Order[]>('/api/orders'),
  today: () => call<Order[]>('/api/orders?view=today'),
  collected: () => call<{ id: string; token: string }[]>('/api/orders?view=collected'),
  menu: () => call<Overrides>('/api/menu'),
  checkPin: (pin: string) => call<{ ok: true }>('/api/staff', { method: 'POST', headers: { 'x-staff-pin': pin } }),
  claim: (id: string, action: 'paid' | 'cancel') =>
    call<Order>(`/api/orders/${id}/claim`, { method: 'POST', body: JSON.stringify({ action }) }),
  mockPay: (id: string) => call<Order>(`/api/orders/${id}/pay`, { method: 'POST' }),
  // `from` = the status this screen shows; the server refuses (409) if another screen changed it first.
  setStatus: (id: string, to: OrderStatus, pin: string, from?: OrderStatus) =>
    call<Order>(`/api/orders/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ to, from }),
      headers: { 'x-staff-pin': pin },
    }),
};

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

// After a deploy, open screens are still running the old code. This asks the server once a minute
// which build it runs and reloads the page when it differs, but only while `safe` is true (the
// kiosk passes "on the start screen", so a customer's order is never interrupted).
export function useAutoReload(safe = true) {
  const target = useRef<string | null>(null);
  usePoll(async () => {
    const { build } = await call<{ build: string }>('/api/version');
    if (build && build !== BUILD_ID) target.current = build;
  }, 60_000);
  const maybeReload = useCallback(() => {
    const to = target.current;
    if (!to) return;
    // Reload once per new build. If the page still isn't on that build afterwards (a misconfigured
    // build id), it must not reload again and again: remember which build we already reloaded for.
    try {
      if (sessionStorage.getItem(RELOADED_FOR) === to) return;
      sessionStorage.setItem(RELOADED_FOR, to);
    } catch {
      return;
    }
    window.location.reload();
  }, []);
  useEffect(() => {
    if (safe) maybeReload();
  });
  // also check at the moment it becomes safe, between two polls
  useEffect(() => {
    if (!safe) return;
    const t = setInterval(maybeReload, 5000);
    return () => clearInterval(t);
  }, [safe, maybeReload]);
}
const RELOADED_FOR = 'benne14.reloadedFor';

// A short two-note chime made in the browser (no audio files). Browsers only allow sound after a tap.
export function chime(ctx: AudioContext | null, notes = [880, 1320]) {
  if (!ctx) return;
  notes.forEach((f, i) => {
    const o = ctx.createOscillator(),
      g = ctx.createGain();
    o.frequency.value = f;
    o.type = 'sine';
    const t = ctx.currentTime + i * 0.16;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.55);
  });
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

// Owner dashboard calls (behind the staff PIN for now).
const pinHeader = (pin: string) => ({ 'x-staff-pin': pin });
export interface Report {
  from: string;
  to: string;
  current: Summary;
  previous: { from: string; to: string; summary: Summary };
}
export const admin = {
  report: (pin: string, from: string, to: string) =>
    call<Report>(`/api/admin/report?from=${from}&to=${to}`, { headers: pinHeader(pin) }),
  events: (pin: string) => call<AdminEvent[]>('/api/admin/events', { headers: pinHeader(pin) }),
  // One request per edit: the dish's fields and any extras' prices save together or not at all.
  saveItem: (
    pin: string,
    b: {
      itemId: string;
      name?: string | null;
      desc?: string | null;
      price?: number | null;
      soldOut?: boolean;
      options?: { groupId: string; optionId: string; price: number }[];
    },
  ) => call('/api/admin/menu', { method: 'POST', body: JSON.stringify(b), headers: pinHeader(pin) }),
  refund: (pin: string, id: string, reason: string) =>
    call<Order>(`/api/admin/orders/${id}/refund`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
      headers: pinHeader(pin),
    }),
  offers: (pin: string) =>
    call<{ settings: KioskSettings; codes: DiscountCode[]; today: string }>('/api/admin/offers', {
      headers: pinHeader(pin),
    }),
  saveSettings: (pin: string, settings: Partial<KioskSettings>) =>
    call<{ settings: KioskSettings }>('/api/admin/offers', {
      method: 'POST',
      body: JSON.stringify({ settings }),
      headers: pinHeader(pin),
    }),
  saveCode: (pin: string, code: Partial<DiscountCode> & { code: string }) =>
    call<{ code: DiscountCode }>('/api/admin/offers', {
      method: 'POST',
      body: JSON.stringify({ code }),
      headers: pinHeader(pin),
    }),
  customers: (pin: string) => call<Customer[]>('/api/admin/customers', { headers: pinHeader(pin) }),
  // CSV comes back as a file; the browser saves it (a plain link can't send the PIN header).
  async download(pin: string, kind: 'bills' | 'gst' | 'dishes' | 'customers', from = '', to = '') {
    const url0 =
      kind === 'customers' ? '/api/admin/customers?format=csv' : `/api/admin/export?kind=${kind}&from=${from}&to=${to}`;
    const r = await fetch(url0, {
      headers: pinHeader(pin),
      cache: 'no-store',
    });
    if (!r.ok)
      throw new ApiError(
        ((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`,
        r.status,
      );
    const url = URL.createObjectURL(await r.blob());
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: kind === 'customers' ? 'benne14-customers.csv' : `benne14-${kind}-${from}-to-${to}.csv`,
    });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },
};

export const newKey = () =>
  crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
