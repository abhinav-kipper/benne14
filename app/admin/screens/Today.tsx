'use client';
// Today at a glance: takings vs yesterday, payments waiting, the kitchen right now, what's selling.
import { useState } from 'react';
import { api } from '@/lib/client';
import { istDay, type Order, type OrderStatus } from '@/lib/orders';
import { Bar, DishRow, Hours, Split, dayLabel, inr, time, useReport, type Ctx, type Tab } from './shared';

export function Today(p: Ctx & { live: Order[]; refreshLive: () => void; go: (t: Tab) => void }) {
  const today = istDay();
  const { r, err } = useReport(p, today, today, 15_000);
  const s = r?.current,
    y = r?.previous.summary;
  const due = p.live.filter((o) => o.status === 'awaiting_cash');
  const count = (st: OrderStatus) => p.live.filter((o) => o.status === st).length;
  const [busy, setBusy] = useState<string | null>(null);
  const paid = async (o: Order) => {
    setBusy(o.id);
    try {
      await api.setStatus(o.id, 'new', p.pin, o.status);
    } catch (e) {
      p.onAuthError(e);
    }
    setBusy(null);
    p.refreshLive();
  };
  const diff = s && y ? s.takings - y.takings : 0;
  return (
    <section className="screen-today">
      <Bar
        right={
          <>
            <b>{dayLabel(today)}</b>Today
          </>
        }
      />
      <div className="slip" data-testid="today-slip">
        <div className="top">
          <span className="eyebrow">Today&apos;s takings</span>
          <span className="live">
            <i />
            Live
          </span>
        </div>
        <div className="big" data-testid="today-takings">
          {s ? inr(s.takings) : '…'}
        </div>
        {s && y && (
          <div className={`vs ${diff < 0 ? 'down' : ''}`}>
            {diff === 0
              ? 'Same as yesterday'
              : `${diff > 0 ? '▲' : '▼'} ${inr(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} than yesterday`}
          </div>
        )}
        {err && <div className="vs down">{err}</div>}
        <div className="three">
          <div>
            <b data-testid="today-orders">{s?.orders ?? '–'}</b>orders
          </div>
          <div>
            <b>{s ? inr(s.avgBill) : '–'}</b>average bill
          </div>
          <div>
            <b>{s ? inr(s.refunds.amount) : '–'}</b>refunds
          </div>
        </div>
        {s && <Split s={s} />}
      </div>

      {due.length > 0 && (
        <div className="sec">
          <div className="sec-h">
            <h2>Needs you</h2>
            <button className="link" onClick={() => p.go('orders')}>
              All orders →
            </button>
          </div>
          {due.map((o) => (
            <div className="need" key={o.id} data-testid={`need-${o.token}`}>
              <span className="tok">{o.token}</span>
              <div className="what">
                <b>
                  {o.payMethod === 'upi' ? 'UPI' : o.payMethod === 'card' ? 'Card' : 'Cash'} {inr(o.total)} ·{' '}
                  {o.payMethod === 'upi' ? 'says paid' : 'at counter'}
                </b>
                {o.payMethod === 'upi'
                  ? 'Check the soundbox'
                  : `${o.itemCount} ${o.itemCount === 1 ? 'item' : 'items'}`}
                {o.customerName ? ` · ${o.customerName}` : ''} · {time(o.createdAt)}
              </div>
              <button onClick={() => paid(o)} disabled={busy === o.id}>
                Paid
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="sec">
        <div className="sec-h">
          <h2>Kitchen now</h2>
        </div>
        <div className="kitchen-now">
          <div>
            <b>{count('new')}</b>waiting
          </div>
          <div>
            <b>{count('cooking')}</b>on the tawa
          </div>
          <div>
            <b>{count('ready')}</b>ready
          </div>
        </div>
      </div>

      <div className="sec">
        <div className="sec-h">
          <h2>Selling today</h2>
          <button className="link" onClick={() => p.go('reports')}>
            Reports →
          </button>
        </div>
        {s && s.dishes.length === 0 && <div className="none">No orders yet today.</div>}
        {s?.dishes.slice(0, 5).map((d) => (
          <DishRow key={d.itemId} d={d} max={s.dishes[0].qty} />
        ))}
      </div>

      {s && (
        <div className="sec">
          <div className="sec-h">
            <h2>Busy hours</h2>
          </div>
          <Hours s={s} days={1} />
        </div>
      )}
    </section>
  );
}
