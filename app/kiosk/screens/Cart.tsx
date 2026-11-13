'use client';
// The order so far, the bill (with a discount code if the owner allows them), the name to call, an
// optional phone number for offers, and dine in or takeaway.
import { useState } from 'react';
import { useCatalog } from '@/components/Catalog';
import { ApiError } from '@/lib/client';
import { cleanPhone, describeCode, type DiscountRule, type KioskSettings } from '@/lib/discounts';
import { itemById } from '@/lib/menu';
import type { OrderType } from '@/lib/orders';
import { itemTotal, type priceOrder } from '@/lib/pricing';
import { suggestFor } from '@/lib/suggest';
import { BagIcon, Chevron, DineIcon, Photo, type Line } from './shared';

export function Cart(p: {
  lines: Line[];
  type: OrderType | null;
  setType: (t: OrderType) => void;
  name: string;
  setName: (n: string) => void;
  asks: KioskSettings; // which optional fields the owner has switched on
  popular: string[]; // the shop's best sellers, best first
  phone: string;
  setPhone: (p: string) => void;
  code: DiscountRule | null;
  onCode: (typed: string) => Promise<void>; // rejects with the reason when the code doesn't work
  onCodeRemove: () => void;
  priced: ReturnType<typeof priceOrder>;
  setQty: (uid: string, q: number) => void;
  onEdit: (uid: string) => void;
  onAdd: (id: string) => void;
  onBack: () => void;
  onPay: () => void;
}) {
  const catalog = useCatalog();
  const hasDosa = p.lines.some((l) => itemById(l.itemId, catalog)?.cat === 'dosa');
  // What this order is missing (a drink, a side…), best sellers first; never what is already in it.
  const upsell = suggestFor(
    p.lines.map((l) => l.itemId),
    catalog,
    p.popular,
  );
  const soldOut = p.lines.filter((l) => itemById(l.itemId, catalog)?.soldOut);
  const [typed, setTyped] = useState('');
  const [codeErr, setCodeErr] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const apply = async () => {
    if (!typed.trim() || checking) return;
    setChecking(true);
    setCodeErr(null);
    try {
      await p.onCode(typed);
      setTyped('');
    } catch (e) {
      // the server's own words for a code that doesn't work; a plain line when it couldn't be reached
      setCodeErr(e instanceof ApiError && e.status < 500 ? e.message : 'Couldn’t check the code. Try again.');
    }
    setChecking(false);
  };
  // A number that was started must be a whole one; an empty field is fine (it is optional).
  const badPhone = p.asks.phone && p.phone !== '' && !cleanPhone(p.phone);
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
              <span className="alt">Goes well with your {hasDosa ? 'dosa' : 'order'}</span>
            </div>
            <div className="strip">
              {upsell.map((it) => {
                return (
                  <button className="mini" key={it.id} onClick={() => p.onAdd(it.id)} data-testid={`suggest-${it.id}`}>
                    <div className="ph">
                      <Photo item={it} />
                    </div>
                    <div>
                      {/* the short name: the card is narrow */}
                      <b>{it.name.replace(/^(Udupi|Bengaluru) /, '')}</b>
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
              <span className="v">₹{itemTotal(p.priced).toFixed(2)}</span>
            </div>
            {p.priced.savings > 0 && (
              <div className="row off" data-testid="discount-row">
                <span>
                  Code {p.priced.discountCode}
                  <button className="rm" onClick={p.onCodeRemove} data-testid="code-remove">
                    Remove
                  </button>
                </span>
                <span className="v">−₹{p.priced.savings.toFixed(2)}</span>
              </div>
            )}
            {/* one line for customers; the CGST / SGST split is on the phone bill */}
            <div className="row muted">
              <span>GST 5%</span>
              <span className="v">₹{(p.priced.cgst + p.priced.sgst).toFixed(2)}</span>
            </div>
          </div>
          <div className="total">
            <span>To pay</span>
            <b data-testid="cart-total">₹{p.priced.total}</b>
          </div>
        </div>
        {p.asks.codes && !p.priced.savings && (
          <div className="name code">
            <div>
              <b>Have a discount code?</b>
              {p.code && p.priced.discountShort > 0 ? (
                <span className="warn" data-testid="code-short">
                  {p.code.code} ({describeCode(p.code)}): add ₹{p.priced.discountShort} more to use it.
                </span>
              ) : codeErr ? (
                <span className="warn" data-testid="code-error">
                  {codeErr}
                </span>
              ) : (
                <span>Optional. Type it here and tap Apply.</span>
              )}
            </div>
            <input
              value={typed}
              onChange={(e) => {
                setTyped(
                  e.target.value
                    .toUpperCase()
                    .replace(/[^A-Z0-9]/g, '')
                    .slice(0, 16),
                );
                setCodeErr(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && apply()}
              placeholder="Code"
              aria-label="Discount code"
              autoCapitalize="characters"
              autoComplete="off"
              data-testid="code-input"
            />
            <button className="apply" onClick={apply} disabled={!typed || checking} data-testid="code-apply">
              {checking ? '…' : 'Apply'}
            </button>
          </div>
        )}
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
        {p.asks.phone && (
          <div className="name">
            <div>
              <b>Phone number for offers</b>
              {badPhone ? (
                <span className="warn" data-testid="phone-error">
                  A mobile number has 10 digits. Fix it or clear the box.
                </span>
              ) : (
                <span>Optional. For offers from Benne 14 by SMS or WhatsApp. We never share it.</span>
              )}
            </div>
            <input
              value={p.phone}
              onChange={(e) => p.setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
              placeholder="10-digit mobile"
              aria-label="Phone number"
              inputMode="numeric"
              autoComplete="off"
              data-testid="phone-input"
            />
          </div>
        )}
      </div>
      <div className="foot">
        <div className="eat">
          <span className="q">Dine in or takeaway?</span>
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
          disabled={!p.type || soldOut.length > 0 || badPhone}
          data-testid="continue-to-pay"
        >
          <span>
            {soldOut.length
              ? 'Remove the sold-out dish'
              : badPhone
                ? 'Check the phone number'
                : p.type
                  ? 'Continue to pay'
                  : 'Choose dine in or takeaway'}
          </span>
          <span className="amt">
            ₹{p.priced.total}
            <i className="go">
              <Chevron />
            </i>
          </span>
        </button>
      </div>
    </div>
  );
}
