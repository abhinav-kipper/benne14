'use client';
import type React from 'react';
import { useOrder } from '@/lib/client';

const HEAD: Record<string, React.ReactNode> = {
  pending_payment: 'पेमेंट का इंतज़ार है।',
  awaiting_cash: 'काउंटर पर पेमेंट कर दीजिए, फिर डोसा तवे पर।',
  new: 'ऑर्डर मिल गया! अभी तवे पर जाएगा।',
  cooking: <>आपका डोसा <b>तवे पर</b> है।</>,
  ready: <><b>तैयार है!</b> काउंटर से ले लीजिए।</>,
  handed_over: 'मज़े से खाइए! फिर आइएगा।',
  cancelled: 'यह ऑर्डर रद्द हो गया।',
};

export default function Receipt({ id }: { id: string }) {
  const o = useOrder(id, 3000);
  if (!o) return <div className="rcpt"><div className="missing">बिल लोड हो रहा है…</div></div>;
  const stage = o.status === 'ready' || o.status === 'handed_over' ? 2 : o.status === 'cooking' ? 1 : 0;
  const when = new Date(o.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
  return (
    <div className="rcpt">
      <div className="logo">Benne <i>14</i><small>AUTHENTIC BANGALORE DOSA · INDIRAPURAM</small></div>
      <div className="tkt">
        <div className="tt"><span>Token</span><span>{o.type === 'dine_in' ? 'Dine-in' : 'Takeaway'}</span></div>
        <div className="num">{o.token}</div>
        <div className="perf" />
        <div className="tb"><span>{o.customerName ?? 'Guest'}</span><span>{o.itemCount} {o.itemCount === 1 ? 'item' : 'items'}</span></div>
      </div>
      <div className="status" data-testid="receipt-status">{HEAD[o.status]}</div>
      <div className="track">
        <div className="st done"><i>✓</i><b>Received</b><span className="hi">मिल गया</span></div>
        <div className={`ln ${stage >= 1 ? 'on' : ''}`} />
        <div className={`st ${stage === 1 ? 'now' : stage > 1 ? 'done' : ''}`}><i>{stage > 1 ? '✓' : ''}</i><b>On the tawa</b><span className="hi">बन रहा है</span></div>
        <div className={`ln ${stage >= 2 ? 'on' : ''}`} />
        <div className={`st ${stage === 2 ? 'done' : ''}`}><i>{stage === 2 ? '✓' : ''}</i><b>Ready</b><span className="hi">तैयार</span></div>
      </div>
      <div className="bill">
        <h3 className="disp">Bill</h3>
        {o.lines.map((l, i) => (
          <div className="li" key={i}>
            <div>{l.qty} × {l.name}<small>{[...l.mods.filter((m) => m.price || m.id !== 'regular').map((m) => m.name + (m.price ? ` +₹${m.price}` : '')), ...l.notes.map((n) => n.label)].join(' · ')}</small></div>
            <span className="v">₹{l.lineTotal}</span>
          </div>
        ))}
        <div style={{ marginTop: 10 }}>
          <div className="row"><span>Item total</span><span>₹{o.subtotal.toFixed(2)}</span></div>
          <div className="row"><span>CGST 2.5%</span><span>₹{o.cgst.toFixed(2)}</span></div>
          <div className="row"><span>SGST 2.5%</span><span>₹{o.sgst.toFixed(2)}</span></div>
          <div className="row"><span>Round off</span><span>{o.roundOff < 0 ? '−' : '+'}₹{Math.abs(o.roundOff).toFixed(2)}</span></div>
        </div>
        <div className="tot"><span className="eyebrow">{o.status === 'awaiting_cash' || o.status === 'pending_payment' ? 'To pay' : `Paid · ${o.payMethod.toUpperCase()}`}</span><b>₹{o.total}</b></div>
        {o.savings > 0 && <div className="saved">Launch offer saved you ₹{o.savings}</div>}
      </div>
      <div className="foot">Benne 14 · Authentic Bangalore Dosa · Indirapuram<br />{when} · Order {o.token}</div>
    </div>
  );
}
