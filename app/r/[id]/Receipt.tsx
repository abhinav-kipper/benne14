'use client';
import type React from 'react';
import { useOrder } from '@/lib/client';

const HEAD: Record<string, React.ReactNode> = {
  pending_payment: 'Waiting for your payment.',
  awaiting_cash: 'Confirming your payment at the counter. Then your dosa goes on the tawa.',
  new: 'Order received! It goes on the tawa next.',
  cooking: <>Your order is <b>on the tawa</b>.</>,
  ready: <><b>Ready!</b> Please collect it from the counter.</>,
  handed_over: 'Enjoy your meal! Come again soon.',
  cancelled: 'This order was cancelled.',
};

const PAY = { upi: 'UPI', card: 'Card', cash: 'Cash' } as const;
const money = (n: number) => `₹${n.toFixed(2)}`;

export default function Receipt({ id }: { id: string }) {
  const o = useOrder(id, 3000);
  if (!o) return <div className="rcpt"><div className="missing">Loading your bill…</div></div>;
  const stage = o.status === 'ready' || o.status === 'handed_over' ? 2 : o.status === 'cooking' ? 1 : 0;
  const when = new Date(o.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
  const unpaid = o.status === 'awaiting_cash' || o.status === 'pending_payment';
  return (
    <div className="rcpt">
      <div className="logo">Benne <i>14</i><small>AUTHENTIC BANGALORE DOSA · INDIRAPURAM</small></div>
      <div className="tkt">
        <div className="tt"><span>Order no.</span><span>{o.type === 'dine_in' ? 'Dine-in' : 'Takeaway'}</span></div>
        <div className="num">{o.token}</div>
        <div className="perf" />
        <div className="tb"><span>{o.customerName ?? 'Guest'}</span><span>{o.itemCount} {o.itemCount === 1 ? 'item' : 'items'}</span></div>
      </div>
      <div className="status" data-testid="receipt-status">{HEAD[o.status]}</div>
      <div className="track">
        <div className="st done"><i>✓</i><b>Received</b></div>
        <div className={`ln ${stage >= 1 ? 'on' : ''}`} />
        <div className={`st ${stage === 1 ? 'now' : stage > 1 ? 'done' : ''}`}><i>{stage > 1 ? '✓' : ''}</i><b>On the tawa</b></div>
        <div className={`ln ${stage >= 2 ? 'on' : ''}`} />
        <div className={`st ${stage === 2 ? 'done' : ''}`}><i>{stage === 2 ? '✓' : ''}</i><b>Ready</b></div>
      </div>

      <div className="bill" data-testid="bill">
        <div className="bh">
          <h3 className="disp">Bill</h3>
          <div><b>Order {o.token}</b><span>{when}</span></div>
        </div>
        <div className="cols"><span>Item</span><span>Qty</span><span>Rate</span><span>Amount</span></div>
        {o.lines.map((l, i) => {
          const extras = l.mods.filter((m) => m.price > 0);
          const choices = [...l.mods.filter((m) => !m.price && m.id !== 'regular').map((m) => m.name), ...l.notes.map((n) => n.label)];
          return (
            <div className="li" key={i}>
              <div className="nm">{l.name}
                {extras.map((m) => <small key={m.id}>+ {m.name} (₹{m.price})</small>)}
                {choices.length > 0 && <small>{choices.join(' · ')}</small>}
              </div>
              <span>{l.qty}</span>
              <span>{money(l.unitPrice)}</span>
              <span className="v">{money(l.lineTotal)}</span>
            </div>
          );
        })}
        <div className="sums">
          <div className="row"><span>Subtotal</span><span>{money(o.subtotal)}</span></div>
          <div className="row"><span>CGST @ 2.5%</span><span>{money(o.cgst)}</span></div>
          <div className="row"><span>SGST @ 2.5%</span><span>{money(o.sgst)}</span></div>
          {o.roundOff !== 0 && <div className="row"><span>Round off</span><span>{o.roundOff < 0 ? '−' : '+'}{money(Math.abs(o.roundOff))}</span></div>}
        </div>
        <div className="tot">
          <span>{unpaid ? 'To pay' : <>Paid by {PAY[o.payMethod]}</>}</span>
          <b data-testid="bill-total">{money(o.total)}</b>
        </div>
        {o.savings > 0 && <div className="saved">Launch offer: you saved ₹{o.savings}</div>}
      </div>
      <div className="foot">Benne 14 · Authentic Bangalore Dosa · Indirapuram<br />Prices in rupees. GST rounded to the nearest rupee.</div>
    </div>
  );
}
