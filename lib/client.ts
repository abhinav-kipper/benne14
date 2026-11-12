'use client';
// Browser-side API calls and live-order hooks for the kiosk, kitchen, board and phone bill.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CartLine } from './pricing';
import type { Order, OrderStatus, OrderType, PayMethod } from './orders';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, cache: 'no-store', headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError((body as { error?: string }).error ?? `HTTP ${r.status}`, r.status);
  return body as T;
}

export const api = {
  placeOrder: (b: { key: string; type: OrderType; name: string | null; payMethod: PayMethod; lines: CartLine[] }) =>
    call<Order>('/api/orders', { method: 'POST', body: JSON.stringify(b) }),
  order: (id: string) => call<Order>(`/api/orders/${id}`),
  live: () => call<Order[]>('/api/orders'),
  checkPin: (pin: string) => call<{ ok: true }>('/api/staff', { method: 'POST', headers: { 'x-staff-pin': pin } }),
  claim: (id: string, action: 'paid' | 'cancel') => call<Order>(`/api/orders/${id}/claim`, { method: 'POST', body: JSON.stringify({ action }) }),
  mockPay: (id: string) => call<Order>(`/api/orders/${id}/pay`, { method: 'POST' }),
  setStatus: (id: string, to: OrderStatus, pin: string) =>
    call<Order>(`/api/orders/${id}/status`, { method: 'POST', body: JSON.stringify({ to }), headers: { 'x-staff-pin': pin } }),
};

// Polls live orders. v1 uses polling (1.5 s) instead of Supabase Realtime: simple, and fast enough
// for three devices; `online` turns false after a failed fetch so screens can show it.
export function useLiveOrders(intervalMs = 1500) {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [online, setOnline] = useState(true);
  const busy = useRef(false);
  const localAt = useRef(0);
  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const started = Date.now();
    try {
      const data = await api.live();
      // A poll that began before the latest tap on this screen carries stale state; dropping it
      // stops the order from flickering back (and replaying its animation) after a tap.
      if (started >= localAt.current) setOrders(data);
      setOnline(true);
    } catch { setOnline(false); } finally { busy.current = false; }
  }, []);
  const noteLocalChange = useCallback(() => { localAt.current = Date.now(); }, []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, intervalMs);
    return () => clearInterval(t);
  }, [refresh, intervalMs]);
  return { orders, setOrders, online, refresh, noteLocalChange };
}

export function useOrder(id: string | null, intervalMs = 1500) {
  const [order, setOrder] = useState<Order | null>(null);
  useEffect(() => {
    if (!id) { setOrder(null); return; }
    let stop = false;
    const tick = async () => { try { const o = await api.order(id); if (!stop) setOrder(o); } catch { /* keep last known */ } };
    tick();
    const t = setInterval(tick, intervalMs);
    return () => { stop = true; clearInterval(t); };
  }, [id, intervalMs]);
  return order;
}

// A short two-note chime made in the browser (no audio files). Browsers only allow sound after a tap.
export function chime(ctx: AudioContext | null, notes = [880, 1320]) {
  if (!ctx) return;
  notes.forEach((f, i) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = f; o.type = 'sine';
    const t = ctx.currentTime + i * 0.16;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.55);
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

export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
