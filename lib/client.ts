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
  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try { setOrders(await api.live()); setOnline(true); } catch { setOnline(false); } finally { busy.current = false; }
  }, []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, intervalMs);
    return () => clearInterval(t);
  }, [refresh, intervalMs]);
  return { orders, setOrders, online, refresh };
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

export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
