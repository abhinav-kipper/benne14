'use client';
// Today's orders: every order of the day, a tap opens one in full, a collected one can be called back.
import { useState } from 'react';
import { counts, type Order, type OrderStatus } from '@/lib/orders';
import { useTodayOrders } from '@/lib/client';

const STATUS_TEXT: Record<OrderStatus, string> = {
  pending_payment: 'Not paid',
  awaiting_cash: 'Payment due',
  new: 'Waiting',
  cooking: 'Cooking',
  ready: 'Ready',
  handed_over: 'Collected',
  cancelled: 'Cancelled',
};
const PAY_TEXT = { upi: 'UPI', card: 'Card', cash: 'Cash' } as const;
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata',
  });

// Today's orders, newest first. Staff can bring a collected order back to the counter shelf.
export function History({ onClose, onRecall }: { onClose: () => void; onRecall: (o: Order) => void }) {
  const orders = useTodayOrders(true, 5000);
  const list = orders ?? [];
  const paid = list.filter(counts); // the same rule as the owner's dashboard: paid, not refunded
  const takings = paid.reduce((a, o) => a + o.total, 0);
  // A long order is cut short in its row; a tap opens it in full (one dish per line, with extras and notes).
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="hist" data-testid="history">
      <div className="scrim" onClick={onClose} />
      <div className="panel">
        <div className="hh">
          <h2 className="disp">Today</h2>
          <div className="sum">
            <b>{paid.length}</b> paid orders<span>·</span>
            <b>₹{takings}</b>
          </div>
          <button className="x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="rows">
          {orders && list.length === 0 && <div className="none">No orders yet today.</div>}
          {list.map((o) => (
            <div
              className={`hr ${o.status} ${open === o.id ? 'open' : ''}`}
              key={o.id}
              data-testid={`hist-${o.token}`}
              onClick={() => setOpen(open === o.id ? null : o.id)}
            >
              <span className="tok">{o.token}</span>
              <div className="mid">
                <div className="l1">
                  <b>{time(o.createdAt)}</b>
                  {o.type === 'dine_in' ? 'Dine-in' : 'Takeaway'}
                  {o.customerName ? ` · ${o.customerName}` : ''}
                  <span className="more">
                    {o.itemCount} {o.itemCount === 1 ? 'item' : 'items'} {open === o.id ? '▴' : '▾'}
                  </span>
                </div>
                {open === o.id ? (
                  <ul className="full" data-testid={`hist-full-${o.token}`}>
                    {o.lines.map((l, i) => {
                      const extra = [
                        ...l.mods.filter((m) => m.price > 0).map((m) => m.name),
                        ...l.notes.map((n) => n.label),
                      ];
                      return (
                        <li key={i}>
                          <b>{l.qty} ×</b> {l.name}
                          {extra.length > 0 && <small>{extra.join(' · ')}</small>}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="l2">{o.lines.map((l) => `${l.qty} × ${l.name}`).join(', ')}</div>
                )}
              </div>
              <div className="amt">
                ₹{o.total}
                <small>{PAY_TEXT[o.payMethod]}</small>
              </div>
              <span className={`st ${o.status}`}>{STATUS_TEXT[o.status]}</span>
              {o.status === 'handed_over' ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation(); // not a tap on the row
                    onRecall(o);
                  }}
                >
                  Back to counter
                </button>
              ) : (
                <i />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
