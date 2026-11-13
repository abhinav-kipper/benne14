'use client';
// Today's orders, and one order's sheet: bill, timeline, Paid / Cancel / recorded refund.
import { useState } from 'react';
import { admin, api, ApiError, useTodayOrders } from '@/lib/client';
import { isPaid, type Order } from '@/lib/orders';
import { Bar, PAY, STATUS, inr, inr2, time, type Ctx } from './shared';

export function Orders(p: Ctx & { refreshLive: () => void }) {
  const all = useTodayOrders(true, 5000) ?? [];
  const [fresh, setFresh] = useState<Record<string, Order>>({}); // results of this screen's own actions, until the next poll
  const list = all.map((o) => (fresh[o.id] && fresh[o.id].updatedAt >= o.updatedAt ? fresh[o.id] : o));
  const [filter, setFilter] = useState<'all' | 'confirm' | 'cancelled'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const confirmN = list.filter((o) => o.status === 'awaiting_cash').length;
  const shown = list.filter(
    (o) =>
      filter === 'all' ||
      (filter === 'confirm' ? o.status === 'awaiting_cash' : o.status === 'cancelled' || !!o.refundedAt),
  );
  const counted = list.filter((o) => isPaid(o) && !o.refundedAt);
  const sel = list.find((o) => o.id === open) ?? null;
  return (
    <section>
      <Bar
        right={
          <>
            <b>Today</b>
            {counted.length} paid orders
          </>
        }
      />
      <div className="h1">Orders</div>
      <div className="filters">
        <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>
          All
        </button>
        <button
          className={filter === 'confirm' ? 'on' : ''}
          onClick={() => setFilter('confirm')}
          data-testid="filter-confirm"
        >
          To confirm{confirmN > 0 && <em>{confirmN}</em>}
        </button>
        <button className={filter === 'cancelled' ? 'on' : ''} onClick={() => setFilter('cancelled')}>
          Cancelled
        </button>
      </div>
      <div className="olist">
        {shown.length === 0 && <div className="none">Nothing here.</div>}
        {shown.map((o) => {
          const [label, cls] = o.refundedAt ? ['Refunded', 'refund'] : STATUS[o.status];
          return (
            <button
              className={`ord ${o.refundedAt || o.status === 'cancelled' ? 'void' : ''}`}
              key={o.id}
              onClick={() => setOpen(o.id)}
              data-testid={`ord-${o.token}`}
            >
              <span className="tok">{o.token}</span>
              <div className="mid">
                <div className="l1">
                  <b>{time(o.createdAt)}</b>
                  {o.type === 'dine_in' ? 'Dine-in' : 'Takeaway'}
                  {o.customerName ? ` · ${o.customerName}` : ''}
                </div>
                <div className="l2">
                  {o.lines.map((l) => `${l.qty} × ${l.name}`).join(', ')}
                  {o.refundReason ? ` · ${o.refundReason}` : ''}
                </div>
              </div>
              <div className="amt">
                <b>{inr(o.total)}</b>
                <span className={`st ${cls}`}>
                  {label}
                  {o.status === 'handed_over' && !o.refundedAt ? ` · ${PAY[o.payMethod]}` : ''}
                </span>
              </div>
            </button>
          );
        })}
      </div>
      {sel && (
        <OrderSheet
          {...p}
          o={sel}
          close={() => setOpen(null)}
          changed={(o) => {
            setFresh((f) => ({ ...f, [o.id]: o }));
            p.refreshLive();
          }}
        />
      )}
    </section>
  );
}

const REASONS = ['Wrong order', 'Customer left', 'Food issue', 'Paid twice'];

export function OrderSheet(p: Ctx & { o: Order; close: () => void; changed: (o: Order) => void }) {
  const { o } = p;
  const [refunding, setRefunding] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [other, setOther] = useState('');
  const [sure, setSure] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (f: () => Promise<Order>) => {
    setBusy(true);
    setErr(null);
    try {
      p.changed(await f());
      setRefunding(false);
      setSure(false);
    } catch (e) {
      p.onAuthError(e);
      setErr(e instanceof ApiError ? e.message : 'No internet. Try again.');
    }
    setBusy(false);
  };
  const unpaid = o.status === 'awaiting_cash' || o.status === 'pending_payment';
  const why = reason === 'Other' ? other.trim() : reason;
  const [label] = o.refundedAt ? ['Refunded'] : STATUS[o.status];
  return (
    <>
      <div className="scrim" onClick={p.close} />
      <div className="sheet" data-testid="order-sheet">
        <div className="grab" />
        <div className="hd">
          <span className="tok">{o.token}</span>
          <div className="meta">
            <b>
              {o.type === 'dine_in' ? 'Dine-in' : 'Takeaway'}
              {o.customerName ? ` · ${o.customerName}` : ''}
            </b>
            <br />
            Today {time(o.createdAt)} · {PAY[o.payMethod]}
            <br />
            <span className="state">{label}</span>
          </div>
        </div>
        <div className="bill">
          {o.lines.map((l, i) => {
            const extras = l.mods.filter((m) => m.price > 0).map((m) => `+ ${m.name} (₹${m.price})`);
            const rest = [
              ...l.mods.filter((m) => !m.price && m.id !== 'regular').map((m) => m.name),
              ...l.notes.map((n) => n.label),
            ];
            return (
              <div className="li" key={i}>
                <div>
                  {l.qty} × {l.name}
                  {(extras.length > 0 || rest.length > 0) && <small>{[...extras, ...rest].join(' · ')}</small>}
                </div>
                <b>{inr2(l.lineTotal)}</b>
              </div>
            );
          })}
          {o.savings > 0 && (
            <div className="row">
              <span>Discount{o.discountCode ? ` (${o.discountCode})` : ''}</span>
              <span>−{inr2(o.savings)}</span>
            </div>
          )}
          <div className="row">
            <span>{o.savings > 0 ? 'After discount' : 'Subtotal'}</span>
            <span>{inr2(o.subtotal)}</span>
          </div>
          <div className="row">
            <span>CGST 2.5% + SGST 2.5%</span>
            <span>{inr2(o.cgst + o.sgst)}</span>
          </div>
          <div className="tot">
            <span>Total</span>
            <b>{inr2(o.total)}</b>
          </div>
        </div>
        <div className="timeline">
          <div>
            <time>{time(o.createdAt)}</time>Ordered at the kiosk
          </div>
          {o.paidAt && (
            <div>
              <time>{time(o.paidAt)}</time>Payment confirmed
            </div>
          )}
          {o.readyAt && (
            <div>
              <time>{time(o.readyAt)}</time>Ready at the counter
            </div>
          )}
          {o.refundedAt && (
            <div>
              <time>{time(o.refundedAt)}</time>Refunded {inr(o.refundAmount ?? o.total)} · {o.refundReason}
            </div>
          )}
        </div>
        {err && <div className="err">{err}</div>}
        <div className="actions">
          {unpaid && (
            <button
              className="btn y"
              disabled={busy}
              onClick={() => act(() => api.setStatus(o.id, 'new', p.pin, o.status))}
              data-testid="sheet-paid"
            >
              Paid
            </button>
          )}
          {unpaid && (
            <button
              className="btn r"
              disabled={busy}
              onClick={() => (sure ? act(() => api.setStatus(o.id, 'cancelled', p.pin, o.status)) : setSure(true))}
              data-testid="sheet-cancel"
            >
              {sure ? 'Yes, cancel this order' : 'Cancel order'}
            </button>
          )}
          {isPaid(o) && !o.refundedAt && !refunding && (
            <button className="btn r" onClick={() => setRefunding(true)} data-testid="sheet-refund">
              Refund this order…
            </button>
          )}
        </div>
        {refunding && (
          <div className="reason">
            <p>
              <b>
                Refund {inr(o.total)}
                {o.customerName ? ` to ${o.customerName}` : ''}?
              </b>{' '}
              Give the money back from the Paytm app or the cash drawer first. This only records it, so the takings stay
              right.
            </p>
            <div className="opts">
              {[...REASONS, 'Other'].map((r) => (
                <button key={r} className={reason === r ? 'on' : ''} onClick={() => setReason(r)}>
                  {r === 'Other' ? 'Other…' : r}
                </button>
              ))}
            </div>
            {reason === 'Other' && (
              <input
                className="in"
                value={other}
                maxLength={80}
                onChange={(e) => setOther(e.target.value)}
                placeholder="What happened?"
                aria-label="Refund reason"
              />
            )}
            <button
              className="btn y"
              style={{ width: '100%', marginTop: 10 }}
              disabled={busy || !why}
              onClick={() => act(() => admin.refund(p.pin, o.id, why!))}
              data-testid="sheet-record-refund"
            >
              Record refund
            </button>
          </div>
        )}
        <div className="actions">
          <button className="btn o" onClick={() => (refunding ? setRefunding(false) : p.close())}>
            {refunding ? 'Don’t refund' : 'Close'}
          </button>
        </div>
      </div>
    </>
  );
}
