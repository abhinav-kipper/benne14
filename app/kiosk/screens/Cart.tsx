'use client';
// The order so far, the bill, the name to call, and dine in or takeaway.
import { useCatalog } from '@/components/Catalog';
import { CART_UPSELL, itemById } from '@/lib/menu';
import type { OrderType } from '@/lib/orders';
import type { priceOrder } from '@/lib/pricing';
import { BagIcon, DineIcon, Photo, type Line } from './shared';

export function Cart(p: {
  lines: Line[];
  type: OrderType | null;
  setType: (t: OrderType) => void;
  name: string;
  setName: (n: string) => void;
  priced: ReturnType<typeof priceOrder>;
  setQty: (uid: string, q: number) => void;
  onEdit: (uid: string) => void;
  onAdd: (id: string) => void;
  onBack: () => void;
  onPay: () => void;
}) {
  const catalog = useCatalog();
  const upsell = CART_UPSELL.filter(
    (id) => !p.lines.some((l) => l.itemId === id) && !itemById(id, catalog)?.soldOut,
  ).slice(0, 3);
  const soldOut = p.lines.filter((l) => itemById(l.itemId, catalog)?.soldOut);
  return (
    <div className="screen k-cart">
      <div className="top">
        <button className="back" onClick={p.onBack}>
          <span>←</span>Menu
        </button>
        <h1 className="disp">Your order</h1>
      </div>
      <div className="body">
        {p.lines.map((l, i) => {
          const it = itemById(l.itemId, catalog)!;
          const pl = p.priced.lines[i];
          return (
            <div className={`line ${it.soldOut ? 'out' : ''}`} key={l.uid} data-testid="cart-line">
              <div className="ph">
                <Photo item={it} />
              </div>
              <div>
                <h3>{it.name}</h3>
                {it.soldOut && (
                  <div className="gone" data-testid="cart-sold-out">
                    Just sold out. Please remove it.
                  </div>
                )}
                <div className="mods">
                  {/* the default of a pick-one choice (e.g. regular sugar) isn't worth a tag */}
                  {pl.mods
                    .filter((m) => m.price || m.id !== catalog.groups[m.groupId]?.defaultId)
                    .map((m) => (
                      <span key={m.groupId + m.id} className={m.price ? 'paid' : ''}>
                        {m.name}
                        {m.price ? ` +₹${m.price}` : ''}
                      </span>
                    ))}
                  {pl.notes.map((n) => (
                    <span key={n.id}>{n.label}</span>
                  ))}
                </div>
                <button className="edit" onClick={() => p.onEdit(l.uid)}>
                  Edit
                </button>
              </div>
              <div className="right">
                <span className="price">₹{pl.lineTotal}</span>
                {l.qty > 1 && <span className="each">₹{pl.unitPrice} each</span>}
                <div className="step">
                  <button onClick={() => p.setQty(l.uid, l.qty - 1)}>−</button>
                  <span>{l.qty}</span>
                  <button onClick={() => p.setQty(l.uid, l.qty + 1)}>+</button>
                </div>
              </div>
            </div>
          );
        })}
        {upsell.length > 0 && (
          <div className="more">
            <div className="gh">
              <h2 className="disp">Anything else?</h2>
              <span className="alt">Goes well with your dosa</span>
            </div>
            <div className="strip">
              {upsell.map((id) => {
                const it = itemById(id, catalog)!;
                return (
                  <button className="mini" key={id} onClick={() => p.onAdd(id)}>
                    <div className="ph">
                      <Photo item={it} />
                    </div>
                    <div>
                      <b>{it.name.replace('Udupi ', '')}</b>
                      <span className="price">₹{it.price}</span>
                    </div>
                    <span className="add">+</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="bill">
          <div className="rows">
            <div className="row">
              <span>
                Item total · {p.priced.itemCount} {p.priced.itemCount === 1 ? 'item' : 'items'}
              </span>
              <span className="v">₹{p.priced.subtotal.toFixed(2)}</span>
            </div>
            <div className="row muted">
              <span>CGST 2.5%</span>
              <span className="v">₹{p.priced.cgst.toFixed(2)}</span>
            </div>
            <div className="row muted">
              <span>SGST 2.5%</span>
              <span className="v">₹{p.priced.sgst.toFixed(2)}</span>
            </div>
          </div>
          <div className="total">
            <span>To pay</span>
            <b data-testid="cart-total">₹{p.priced.total}</b>
          </div>
        </div>
        <div className="name">
          <div>
            <b>What name should we call?</b>
            <span>Optional. We&apos;ll call your name and order number when it&apos;s ready.</span>
          </div>
          <input
            value={p.name}
            onChange={(e) => p.setName(e.target.value.slice(0, 24))}
            placeholder="Your name"
            aria-label="Your name"
          />
        </div>
      </div>
      <div className="foot">
        <div className="eat">
          <span className="q">{p.type ? 'Eating' : 'Dine in or takeaway?'}</span>
          <button
            className={p.type === 'dine_in' ? 'on' : ''}
            onClick={() => p.setType('dine_in')}
            data-testid="dine-in"
          >
            <DineIcon />
            Dine in
          </button>
          <button
            className={p.type === 'takeaway' ? 'on' : ''}
            onClick={() => p.setType('takeaway')}
            data-testid="takeaway"
          >
            <BagIcon />
            Takeaway
          </button>
        </div>
        <button
          className="btn-benne"
          onClick={p.onPay}
          disabled={!p.type || soldOut.length > 0}
          data-testid="continue-to-pay"
        >
          <span>
            {soldOut.length ? 'Remove the sold-out dish' : p.type ? 'Continue to pay' : 'Choose dine in or takeaway'}
          </span>
          <span className="amt">₹{p.priced.total} →</span>
        </button>
        <small>UPI · Card · Cash at counter</small>
      </div>
    </div>
  );
}
