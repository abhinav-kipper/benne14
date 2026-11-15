'use client';
// Browser-side API calls and live-order hooks for the kiosk, kitchen, board and phone bill.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Customer, DiscountCode, DiscountRule, KioskSettings } from './discounts';
import type { CartLine } from './pricing';
import { BEAT_MS, type Alert, type Device, type ErrorEntry, type Problem } from './system';
import type { CustomItem, Overrides } from './menu';
import type { AdminEvent, Order, OrderEvent, OrderStatus, OrderType, PayMethod } from './orders';
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

// No request waits forever: on a weak connection a hung request would leave "Placing your order…"
// on screen with no way out. A timeout fails like any lost connection, and every write can be retried.
const TIMEOUT_MS = 12_000;
async function call<T>(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs, ...rest } = init ?? {};
  const r = await fetch(url, {
    ...rest,
    signal: rest.signal ?? AbortSignal.timeout(timeoutMs ?? TIMEOUT_MS),
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError((body as { error?: string }).error ?? `HTTP ${r.status}`, r.status);
  return body as T;
}

// direct: the shop's own QR, staff confirm (only when no gateway is set up). page: the gateway's
// payment page in a frame. qr: a QR drawn from the gateway's UPI link; those two confirm by
// themselves. down: the gateway is not answering, so the kiosk offers card and cash instead.
export type GatewayView =
  { kind: 'direct' } | { kind: 'page'; url: string } | { kind: 'qr'; svg: string } | { kind: 'down' };

const KIOSK_KEY = 'benne14.kioskKey';
function kioskHeader(): Record<string, string> {
  try {
    const k = localStorage.getItem(KIOSK_KEY);
    return k ? { 'x-kiosk-key': k } : {};
  } catch {
    return {};
  }
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
  }) => call<Order>('/api/orders', { method: 'POST', body: JSON.stringify(b), headers: kioskHeader() }),
  // What the cart asks for (the owner's switches), and whether a code works for this cart.
  // enrolled: is this tablet set up as the shop's kiosk (see lib/kioskkey.ts)?
  kiosk: () => call<KioskSettings & { enrolled: boolean }>('/api/kiosk', { headers: kioskHeader() }),
  // Staff set this tablet up as the kiosk: the PIN is typed once and the tablet keeps a key.
  enrolKiosk: async (pin: string) => {
    const { key } = await call<{ key: string }>('/api/kiosk', { method: 'POST', headers: { 'x-staff-pin': pin } });
    try {
      localStorage.setItem(KIOSK_KEY, key);
    } catch {
      // no storage: the tablet will ask again after a reload
    }
  },
  pinDigits: () => call<{ staffDigits: number; ownerDigits: number }>('/api/staff'),
  popular: () => call<{ ids: string[] }>('/api/popular'),
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
  checkPin: (pin: string, who: 'staff' | 'owner' = 'staff') =>
    call<{ ok: true }>(`/api/staff${who === 'owner' ? '?for=owner' : ''}`, {
      method: 'POST',
      headers: { 'x-staff-pin': pin },
    }),
  claim: (id: string, action: 'paid' | 'cancel') =>
    call<Order>(`/api/orders/${id}/claim`, { method: 'POST', body: JSON.stringify({ action }) }),
  mockPay: (id: string) => call<Order>(`/api/orders/${id}/pay`, { method: 'POST' }),
  // The payment gateway, for the kiosk's UPI screen: how to show this order's payment, and "is it paid yet?"
  gatewayStart: (id: string) =>
    call<GatewayView>(`/api/orders/${id}/gateway`, { method: 'POST', body: JSON.stringify({ action: 'start' }) }),
  gatewayCheck: (id: string) =>
    call<{ order: Order; state: 'paid' | 'failed' | 'waiting' | 'problem'; gatewayStatus?: string }>(
      `/api/orders/${id}/gateway`,
      {
        method: 'POST',
        body: JSON.stringify({ action: 'check' }),
      },
    ),
  // `from` = the status this screen shows; the server refuses (409) if another screen changed it first.
  setGiven: (id: string, line: number, count: number, pin: string) =>
    call<Order>(`/api/orders/${id}/given`, {
      method: 'POST',
      body: JSON.stringify({ line, count }),
      headers: { 'x-staff-pin': pin },
    }),
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
export interface SystemReport {
  now: string;
  build: string;
  store: string;
  payments: string;
  testMode: boolean;
  devices: Device[];
  errors: ErrorEntry[];
  problems: Problem[];
  alerts: Alert[]; // what was announced to the owner's phone: open ones first
  phones: number; // phones with notifications on
}
export const admin = {
  report: (pin: string, from: string, to: string) =>
    call<Report>(`/api/admin/report?from=${from}&to=${to}`, { headers: pinHeader(pin) }),
  events: (pin: string) => call<AdminEvent[]>('/api/admin/events', { headers: pinHeader(pin) }),
  orderEvents: (pin: string, id: string) =>
    call<OrderEvent[]>(`/api/admin/orders/${id}/events`, { headers: pinHeader(pin) }),
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
  // The owner's whole menu (drafts and hidden dishes included) and one change to it at a time.
  dishes: (pin: string) => call<Overrides>('/api/admin/dishes', { headers: pinHeader(pin) }),
  menuChange: (
    pin: string,
    b:
      | { dish: Omit<CustomItem, 'id' | 'live'> & { id?: string } }
      | { publish: string }
      | { discard: string }
      | { hide: string }
      | { show: string }
      | { order: string[] }
      | { section: { id?: string; name: string } }
      | { removeSection: string }
      | { hideSection: string }
      | { showSection: string }
      | { sectionOrder: string[] },
  ) =>
    call<{ dish?: CustomItem }>('/api/admin/dishes', {
      method: 'POST',
      body: JSON.stringify(b),
      headers: pinHeader(pin),
    }),
  // Extras and kitchen notes, one change at a time (see app/api/admin/extras/route.ts).
  extrasChange: (
    pin: string,
    b:
      | { extra: { set: string; id?: string; name: string; price: number } }
      | { hideExtra: string }
      | { showExtra: string }
      | { set: { id?: string; name: string } }
      | { removeSet: string }
      | { dishSets: { itemId: string; sets: string[] } }
      | { note: { id?: string; label: string; tone: 'add' | 'less' | null; cats: string[] } }
      | { hideNote: string }
      | { showNote: string },
  ) =>
    call<{ extra?: { id: string }; set?: { id: string; name: string }; note?: { id: string } }>('/api/admin/extras', {
      method: 'POST',
      body: JSON.stringify(b),
      headers: pinHeader(pin),
    }),
  system: (pin: string) => call<SystemReport>('/api/admin/system', { headers: pinHeader(pin) }),
  pushInfo: (pin: string) =>
    call<{ publicKey: string; phones: number }>('/api/admin/push', { headers: pinHeader(pin) }),
  pushChange: (pin: string, b: { subscribe: PushSubscriptionJSON } | { unsubscribe: string } | { test: true }) =>
    call<{ phones?: number; sent?: number }>('/api/admin/push', {
      method: 'POST',
      body: JSON.stringify(b),
      headers: pinHeader(pin),
    }),
  photo: (pin: string, jpeg: Blob) =>
    call<{ url: string }>('/api/admin/photo', {
      method: 'POST',
      body: jpeg,
      timeoutMs: 45_000, // a photo on a slow connection
      headers: { ...pinHeader(pin), 'Content-Type': 'image/jpeg' },
    }),
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
  deleteCode: (pin: string, code: string) =>
    call<{ removed: string }>('/api/admin/offers', {
      method: 'POST',
      body: JSON.stringify({ remove: code }),
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

// ---- Screens that look after themselves (docs/go-live.md stage 2) ----

// Can the shop take an order right now (server reachable, database answering)? Asked every 10 s.
// One failed answer can be a blip; two in a row means down. The first good answer means up again.
export function useServerUp(on = true) {
  const [up, setUp] = useState(true);
  const fails = useRef(0);
  usePoll(
    async () => {
      try {
        await call<{ ok: boolean }>('/api/ping', { timeoutMs: 6000 });
        fails.current = 0;
        setUp(true);
      } catch {
        if (++fails.current >= 2) setUp(false);
        return false;
      }
    },
    10_000,
    on,
  );
  return up;
}

// Keep the screen on: a kiosk, kitchen display or TV that dims or sleeps is a screen out of service.
// The browser drops the lock whenever the page is hidden, so it is asked for again each time it shows.
export function useAwake() {
  useEffect(() => {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<unknown> } };
    const hold = () => {
      if (!document.hidden) nav.wakeLock?.request('screen').catch(() => {});
    };
    hold();
    document.addEventListener('visibilitychange', hold);
    return () => document.removeEventListener('visibilitychange', hold);
  }, []);
}

// Start fresh once a night: a browser left running for weeks slows down and collects odd state.
// Between 4 and 5 am, once per night, and only when `safe` (nobody is in the middle of anything).
const NIGHTLY = 'benne14.nightly';
export function useNightlyReload(safe = true) {
  const ok = useRef(safe);
  ok.current = safe;
  useEffect(() => {
    const t = setInterval(() => {
      const now = new Date();
      if (now.getHours() !== 4 || !ok.current) return;
      const night = now.toDateString();
      try {
        if (sessionStorage.getItem(NIGHTLY) === night) return;
        sessionStorage.setItem(NIGHTLY, night);
      } catch {
        return;
      }
      window.location.reload();
    }, 60_000);
    return () => clearInterval(t);
  }, []);
}

// Staff's way to unstick a screen with no keyboard: hold the logo for five seconds and it reloads.
const HOLD_RELOAD_MS = 5000;
export function useHoldToReload() {
  const t = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stop = useCallback(() => clearTimeout(t.current), []);
  useEffect(() => stop, [stop]);
  return {
    onPointerDown: () => {
      stop();
      t.current = setTimeout(() => window.location.reload(), HOLD_RELOAD_MS);
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  };
}

// ---- Telling the owner app this screen is alive, and what goes wrong on it ----
const DEVICE_KEY = 'benne14.device';
function deviceId(): string | null {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id || !/^[a-z0-9]{8,24}$/.test(id)) {
      id =
        Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => (b % 36).toString(36)).join('') +
        Date.now().toString(36);
      id = id.slice(0, 20);
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return null; // no storage: this screen goes unlisted, and works all the same
  }
}

// Send one error report. Never throws, never waits, and a screen stuck in a loop of errors sends
// only a few: the first ones say what is wrong.
let reported = 0;
export function reportError(source: 'kiosk' | 'kitchen' | 'board' | 'owner' | 'bill', error: unknown, where = '') {
  if (++reported > 5) return;
  try {
    const e = error instanceof Error ? error : new Error(typeof error === 'string' ? error : JSON.stringify(error));
    void fetch('/api/log', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source,
        message: `${where ? `${where}: ` : ''}${e.message}`.slice(0, 300),
        detail: (e.stack ?? '').slice(0, 2000),
        build: BUILD_ID,
        device: deviceId(),
      }),
    }).catch(() => {});
  } catch {
    // reporting must never be what breaks the screen
  }
}

// One line per screen: say "I'm here" every half minute (which screen, what it is showing, its
// version) and report any error the screen did not handle itself.
export function useWatch(kind: 'kiosk' | 'kitchen' | 'board' | 'owner', screen = '') {
  const showing = useRef(screen);
  showing.current = screen;
  usePoll(async () => {
    const id = deviceId();
    if (!id) return;
    await fetch('/api/beat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, kind, screen: showing.current, build: BUILD_ID }),
      signal: AbortSignal.timeout(8000),
    }).catch(() => {});
  }, BEAT_MS);
  useEffect(() => {
    const onError = (e: ErrorEvent) => reportError(kind, e.error ?? e.message, showing.current);
    const onReject = (e: PromiseRejectionEvent) => reportError(kind, e.reason, showing.current);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onReject);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onReject);
    };
  }, [kind]);
}
