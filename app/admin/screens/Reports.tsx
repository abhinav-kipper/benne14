'use client';
// Takings, dishes, busy hours and GST for a day, week, month or custom range, with CSV downloads.
import { useMemo, useState } from 'react';
import { admin, ApiError } from '@/lib/client';
import { addDays, istDay } from '@/lib/orders';
import { Bar, Hours, Split, dayLabel, inr, inr2, useReport, type Ctx } from './shared';

type Range = 'day' | 'week' | 'month' | 'custom';
export function rangeFor(kind: Range, anchor: string, custom: { from: string; to: string }) {
  if (kind === 'day') return { from: anchor, to: anchor };
  if (kind === 'week') return { from: addDays(anchor, -6), to: anchor };
  if (kind === 'month') {
    const first = anchor.slice(0, 8) + '01';
    const next = new Date(Date.parse(first + 'T00:00:00Z'));
    next.setUTCMonth(next.getUTCMonth() + 1);
    return { from: first, to: addDays(next.toISOString().slice(0, 10), -1) };
  }
  return custom;
}
export function stepAnchor(kind: Range, anchor: string, dir: 1 | -1) {
  if (kind === 'day') return addDays(anchor, dir);
  if (kind === 'week') return addDays(anchor, 7 * dir);
  const d = new Date(Date.parse(anchor.slice(0, 8) + '01T00:00:00Z'));
  d.setUTCMonth(d.getUTCMonth() + dir);
  return d.toISOString().slice(0, 10);
}
const pct = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 100) : null);

export function Reports(p: Ctx) {
  const today = istDay();
  const [kind, setKind] = useState<Range>('week');
  const [anchor, setAnchor] = useState(today);
  const [custom, setCustom] = useState({ from: addDays(today, -29), to: today });
  const { from, to } = useMemo(() => rangeFor(kind, anchor, custom), [kind, anchor, custom]);
  const { r, err } = useReport(p, from, to);
  const [allDishes, setAllDishes] = useState(false);
  const [dl, setDl] = useState<string | null>(null);
  const s = r?.current,
    y = r?.previous.summary;
  const days = r ? r.current.days.length : 1;
  const label =
    from === to
      ? dayLabel(from, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
      : `${dayLabel(from, { day: 'numeric', month: 'short' })} – ${dayLabel(to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const download = async (k: 'bills' | 'gst' | 'dishes') => {
    setDl(null);
    try {
      await admin.download(p.pin, k, from, to);
    } catch (e) {
      p.onAuthError(e);
      setDl(e instanceof ApiError ? e.message : 'No internet. Try again.');
    }
  };
  const kpi = (name: string, val: string, now: number, before: number | undefined, money = false) => {
    const d = before === undefined ? null : pct(now, before);
    return (
      <div className="kpi">
        <span className="eyebrow">{name}</span>
        <b>{val}</b>
        {before !== undefined && (
          <small className={now < before ? 'down' : ''}>
            {d === null ? (now ? 'new' : '—') : `${d >= 0 ? '▲' : '▼'} ${Math.abs(d)}%`} vs{' '}
            {kind === 'day' ? 'day before' : 'before'}
            {money ? '' : ''}
          </small>
        )}
      </div>
    );
  };
  const maxDay = Math.max(...(s?.days.map((d) => d.takings) ?? [0]), 0);
  return (
    <section>
      <Bar />
      <div className="h1">Reports</div>
      <div className="range">
        {(['day', 'week', 'month', 'custom'] as const).map((k) => (
          <button
            key={k}
            className={kind === k ? 'on' : ''}
            onClick={() => {
              setKind(k);
              setAnchor(today);
            }}
            data-testid={`range-${k}`}
          >
            {k[0].toUpperCase() + k.slice(1)}
          </button>
        ))}
      </div>
      {kind === 'custom' ? (
        <div className="custom">
          <input
            type="date"
            value={custom.from}
            max={custom.to}
            onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })}
            aria-label="From"
          />
          <span>to</span>
          <input
            type="date"
            value={custom.to}
            min={custom.from}
            onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })}
            aria-label="To"
          />
        </div>
      ) : (
        <div className="period">
          <button onClick={() => setAnchor(stepAnchor(kind, anchor, -1))} aria-label="Earlier">
            ‹
          </button>
          <span data-testid="period">{label}</span>
          <button onClick={() => setAnchor(stepAnchor(kind, anchor, 1))} disabled={to >= today} aria-label="Later">
            ›
          </button>
        </div>
      )}
      {err && <div className="err pad">{err}</div>}
      {!s && !err && <div className="none pad">Loading…</div>}
      {s && y && (
        <>
          <div className="kpis">
            {kpi('Takings', inr(s.takings), s.takings, y.takings, true)}
            {kpi('Orders', String(s.orders), s.orders, y.orders)}
            {kpi('Average bill', inr(s.avgBill), s.avgBill, y.avgBill, true)}
            <div className="kpi">
              <span className="eyebrow">Refunds</span>
              <b>{inr(s.refunds.amount)}</b>
              <small className={s.refunds.count ? 'down' : ''}>
                {s.refunds.count} {s.refunds.count === 1 ? 'order' : 'orders'}
              </small>
            </div>
          </div>
          <div className="sec">
            <Split s={s} />
          </div>
          {days > 1 && days <= 31 && (
            <div className="sec days">
              <div className="sec-h">
                <h2>By day</h2>
              </div>
              <div className="bars">
                {s.days.map((d) => (
                  <i
                    key={d.day}
                    title={`${d.day}: ${inr(d.takings)}`}
                    className={d.takings === maxDay && maxDay > 0 ? 'hi' : ''}
                    style={{ height: `${maxDay ? (d.takings / maxDay) * 100 : 0}%` }}
                  />
                ))}
              </div>
              <div className="axis">
                {s.days.map((d, i) => (
                  <span key={d.day}>
                    {days <= 7 ? dayLabel(d.day, { weekday: 'short' }) : i % 5 === 0 ? d.day.slice(8) : ''}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="sec">
            <div className="sec-h">
              <h2>Dishes</h2>
              {s.dishes.length > 5 && (
                <button className="link" onClick={() => setAllDishes(!allDishes)}>
                  {allDishes ? 'Top 5' : `All ${s.dishes.length} →`}
                </button>
              )}
            </div>
            {s.dishes.length === 0 ? (
              <div className="none">No orders in this period.</div>
            ) : (
              <table className="tbl" data-testid="dishes">
                <thead>
                  <tr>
                    <th>Dish</th>
                    <th>Sold</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(allDishes ? s.dishes : s.dishes.slice(0, 5)).map((d) => (
                    <tr key={d.itemId}>
                      <td>{d.name}</td>
                      <td>{d.qty}</td>
                      <td>{inr(d.amount)}</td>
                    </tr>
                  ))}
                  {s.extras.qty > 0 && (
                    <tr className="sub">
                      <td>Extras</td>
                      <td>{s.extras.qty}</td>
                      <td>{inr(s.extras.amount)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
            <div className="was">Amounts before GST.</div>
          </div>
          <div className="sec">
            <div className="sec-h">
              <h2>Busy hours</h2>
            </div>
            <Hours s={s} days={days} />
          </div>
          <div className="sec">
            <div className="sec-h">
              <h2>GST for the CA</h2>
            </div>
            <div className="gst" data-testid="gst">
              <div className="row">
                <span>Taxable value</span>
                <b>{inr2(s.gst.taxable)}</b>
              </div>
              <div className="row">
                <span>CGST @ 2.5%</span>
                <b>{inr2(s.gst.cgst)}</b>
              </div>
              <div className="row">
                <span>SGST @ 2.5%</span>
                <b>{inr2(s.gst.sgst)}</b>
              </div>
              <div className="row">
                <span>Total billed</span>
                <b>{inr2(s.gst.total)}</b>
              </div>
            </div>
            <div className="was">
              Paid orders only. Refunded and cancelled orders are left out.
              {s.discounts.amount > 0 &&
                ` Discount codes took off ${inr(s.discounts.amount)} on ${s.discounts.count} ${s.discounts.count === 1 ? 'order' : 'orders'} (already left out of these numbers).`}
            </div>
          </div>
          <div className="dl">
            {(
              [
                ['bills', 'Every bill', `${s.orders + s.refunds.count} rows`],
                ['gst', 'GST by day', `${days} rows`],
                ['dishes', 'Dish-wise sales', `${s.dishes.length + (s.extras.qty ? 1 : 0)} rows`],
              ] as const
            ).map(([k, t, n]) => (
              <button key={k} onClick={() => download(k)} data-testid={`dl-${k}`}>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" />
                </svg>
                {t} (CSV)<small>{n}</small>
              </button>
            ))}
            {dl && <div className="err">{dl}</div>}
          </div>
        </>
      )}
    </section>
  );
}
