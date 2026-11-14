'use client';
// Pieces the dashboard screens share: formatting, the top bar, the report loader and the small charts.
import { useEffect, useRef, useState } from 'react';
import { admin, ApiError, usePoll, type Report } from '@/lib/client';
import { useCatalog } from '@/components/Catalog';
import { itemById, photoFor, placeholderOf } from '@/lib/menu';
import type { OrderStatus } from '@/lib/orders';
import type { Summary } from '@/lib/reports';

export type Tab = 'today' | 'orders' | 'menu' | 'offers' | 'reports' | 'history';
export const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
export const inr2 = (n: number) =>
  '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata',
  });
export const dayLabel = (
  d: string,
  opts: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'short' },
) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-IN', { ...opts, timeZone: 'UTC' });
export const hourLabel = (h: number) => (h % 12 || 12) + (h < 12 ? ' am' : ' pm');
export const hourTick = (h: number) => String(h % 12 || 12);

export interface Ctx {
  pin: string;
  onAuthError: (e: unknown) => void;
}

export function Bar({ right }: { right?: React.ReactNode }) {
  return (
    <div className="bar">
      <div className="logo">
        Benne <i>14</i>
      </div>
      {right && <div className="when">{right}</div>}
    </div>
  );
}

export function useReport({ pin, onAuthError }: Ctx, from: string, to: string, every = 0) {
  const [r, setR] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const range = useRef({ from, to });
  range.current = { from, to }; // an answer for a range the owner has already left is dropped
  // `every` = 0: load once per range (a day keeps the poll asleep); otherwise refresh on that interval.
  const reload = usePoll(
    async () => {
      try {
        const x = await admin.report(pin, from, to);
        if (x.from === range.current.from && x.to === range.current.to) setR(x);
        setErr(null);
      } catch (e) {
        onAuthError(e);
        setErr(e instanceof ApiError ? e.message : 'No internet');
        return false;
      }
    },
    every || 24 * 3600_000,
    true,
  );
  useEffect(() => {
    setR(null);
    reload();
  }, [from, to, reload]);
  return { r, err };
}

export function Split({ s }: { s: Summary }) {
  const t = s.split.upi + s.split.card + s.split.cash;
  const parts = [
    ['UPI', s.split.upi, 'var(--cream)'],
    ['Card', s.split.card, 'var(--benne)'],
    ['Cash', s.split.cash, 'var(--s3)'],
  ] as const;
  return (
    <div className="split">
      <div className="track">
        {t > 0 ? (
          parts.map(([k, v, c]) => <i key={k} style={{ flex: v, background: c }} />)
        ) : (
          <i style={{ flex: 1, background: 'var(--s2)' }} />
        )}
      </div>
      <div className="legend">
        {parts.map(([k, v, c]) => (
          <div key={k} style={{ '--c': c } as React.CSSProperties}>
            <span>{k}</span>
            <b>{inr(v)}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DishRow({ d, max }: { d: Summary['dishes'][number]; max: number }) {
  const dish = itemById(d.itemId, useCatalog());
  const src = photoFor(dish) ?? photoFor({ id: d.itemId });
  return (
    <div className="dish">
      {src ? (
        <img src={src} alt="" />
      ) : (
        <div className="ph">{dish?.custom ? d.name.split(' ').slice(0, 2).join(' ') : placeholderOf(d.itemId)}</div>
      )}
      <div>
        <b>{d.name}</b>
        <small>{inr(d.amount)}</small>
        <div className="meter">
          <i style={{ width: `${max ? (d.qty / max) * 100 : 0}%` }} />
        </div>
      </div>
      <div className="r">
        <b>{d.qty}</b>
        <small>sold</small>
      </div>
    </div>
  );
}

export function Hours({ s, days }: { s: Summary; days: number }) {
  const vals = s.hours.map((h) => h.orders / days);
  const max = Math.max(...vals, 0);
  const peak = max > 0 ? s.hours[vals.indexOf(max)] : null;
  const fmt = (v: number) => (days > 1 ? v.toFixed(v < 10 ? 1 : 0) : String(v));
  return (
    <div className="hours" data-testid="hours">
      <div className="bars">
        {s.hours.map((h, i) => (
          <i
            key={h.hour}
            className={peak && h.hour === peak.hour ? 'peak' : ''}
            style={{ height: `${max ? (vals[i] / max) * 100 : 0}%` }}
          >
            {peak && h.hour === peak.hour && <b>{fmt(vals[i])}</b>}
          </i>
        ))}
      </div>
      <div className="axis">
        {s.hours.map((h) => (
          <span key={h.hour}>{hourTick(h.hour)}</span>
        ))}
      </div>
      <div className="note">
        {peak ? (
          <>
            {days > 1 ? 'Average orders per hour. ' : ''}Busiest:{' '}
            <b>
              {hourLabel(peak.hour)}–{hourLabel(peak.hour + 1)}
            </b>
            {days > 1 ? '' : `, ${peak.orders} orders`}.
          </>
        ) : (
          'No orders yet.'
        )}
      </div>
    </div>
  );
}

export const STATUS: Record<OrderStatus, [string, string]> = {
  pending_payment: ['QR open', 'due'],
  awaiting_cash: ['To confirm', 'due'],
  new: ['Waiting', 'cooking'],
  cooking: ['On the tawa', 'cooking'],
  ready: ['Ready', 'ready'],
  handed_over: ['Collected', 'done'],
  cancelled: ['Cancelled', 'done'],
};
export const PAY = { upi: 'UPI', card: 'Card', cash: 'Cash' } as const;
