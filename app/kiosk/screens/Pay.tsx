'use client';
// How to pay: UPI, card or cash. Choosing one places the order.
import { useState } from 'react';
import { useCatalog } from '@/components/Catalog';
import { ApiError } from '@/lib/client';
import { itemById } from '@/lib/menu';
import type { OrderType, PayMethod } from '@/lib/orders';
import type { priceOrder } from '@/lib/pricing';
import type { Line } from './shared';

export function Pay({
  priced,
  lines,
  type,
  name,
  onBack,
  onChoose,
}: {
  priced: ReturnType<typeof priceOrder>;
  lines: Line[];
  type: OrderType;
  name: string;
  onBack: () => void;
  onChoose: (m: PayMethod) => Promise<void>;
}) {
  const catalog = useCatalog();
  const [busy, setBusy] = useState<PayMethod | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const choose = async (m: PayMethod) => {
    if (busy) return;
    setBusy(m);
    setErr(null);
    try {
      await onChoose(m);
    } catch (e) {
      // Customers see a calm message; the technical reason stays in the console and server logs.
      console.error('Order failed', e);
      const ours = e instanceof ApiError && e.status < 500;
      setErr(
        ours ? (e as ApiError).message : "Your order didn't go through. Please tap again, or tell us at the counter.",
      );
      setBusy(null);
    }
  };
  return (
    <div className="screen k-pay">
      <button className="back" onClick={onBack} disabled={!!busy}>
        <span>←</span>Order
      </button>
      <div className="head">
        <div className="amount">
          <div className="eyebrow">Amount to pay</div>
          <b>₹{priced.total}</b>
          <div className="how">How would you like to pay?</div>
        </div>
        <div className="slip">
          <div className="sh">
            <span>{type === 'dine_in' ? 'Dine-in' : 'Takeaway'}</span>
            <span>{name.trim() || 'Guest'}</span>
          </div>
          {lines.slice(0, 4).map((l) => (
            <div className="li" key={l.uid}>
              <b>{l.qty}×</b>
              {itemById(l.itemId, catalog)!.name}
            </div>
          ))}
          {lines.length > 4 && (
            <div className="li">
              <b>+</b>
              {lines.length - 4} more
            </div>
          )}
          <div className="sf">
            <i />
            <span>₹{priced.total}</span>
          </div>
        </div>
      </div>
      <button className="tile upi" onClick={() => choose('upi')} disabled={!!busy} data-testid="pay-upi">
        <span className="lead">{busy === 'upi' ? 'Getting your QR ready…' : 'Most people pay this way'}</span>
        <span className="big">UPI</span>
        <span className="alt">Scan with any UPI app</span>
        <span className="apps">Google Pay, PhonePe, Paytm, BHIM or any UPI app</span>
        <svg viewBox="0 0 250 312" fill="none" stroke="currentColor" strokeWidth="8" strokeLinejoin="round">
          <rect x="40" y="6" width="170" height="300" rx="28" />
          <path d="M100 26h50" strokeLinecap="round" />
          <g fill="currentColor" stroke="none">
            <rect x="66" y="70" width="44" height="44" />
            <rect x="140" y="70" width="44" height="44" />
            <rect x="66" y="196" width="44" height="44" />
            <rect x="140" y="160" width="14" height="14" />
            <rect x="160" y="176" width="14" height="14" />
            <rect x="140" y="196" width="14" height="14" />
            <rect x="170" y="210" width="14" height="14" />
            <rect x="150" y="226" width="14" height="14" />
            <rect x="118" y="130" width="14" height="14" />
            <rect x="88" y="140" width="14" height="14" />
            <rect x="66" y="160" width="14" height="14" />
            <rect x="118" y="170" width="14" height="14" />
            <rect x="118" y="214" width="14" height="14" />
          </g>
          <g fill="#F5C542" stroke="none">
            <rect x="77" y="81" width="22" height="22" />
            <rect x="151" y="81" width="22" height="22" />
            <rect x="77" y="207" width="22" height="22" />
          </g>
          <path d="M20 150h210" stroke="#D14F2B" strokeWidth="6" strokeLinecap="round" />
        </svg>
      </button>
      <div className="row">
        <button className="tile half card" onClick={() => choose('card')} disabled={!!busy} data-testid="pay-card">
          <svg
            viewBox="0 0 170 110"
            fill="none"
            stroke="currentColor"
            strokeWidth="7"
            strokeLinejoin="round"
            strokeLinecap="round"
          >
            <rect x="4" y="14" width="136" height="90" rx="12" />
            <rect x="22" y="36" width="30" height="22" rx="4" />
            <path d="M22 84h44M80 84h22" />
            <path d="M150 32c8 8 8 26 0 34M160 22c14 14 14 40 0 54" />
          </svg>
          <span className="big">Card</span>
          <span className="alt">Debit or credit card</span>
          <small>Tap or insert on the machine at the counter</small>
        </button>
        <button className="tile half cash" onClick={() => choose('cash')} disabled={!!busy} data-testid="pay-cash">
          <svg viewBox="0 0 170 110" fill="none" stroke="currentColor" strokeWidth="7" strokeLinejoin="round">
            <rect x="24" y="4" width="140" height="74" rx="8" opacity=".45" />
            <rect x="4" y="28" width="140" height="78" rx="8" fill="#FFFFFF" />
            <circle cx="74" cy="67" r="20" />
            <path d="M66 58h17M66 66h17M70 58c10 0 10 14 0 14l12 12" strokeLinecap="round" strokeWidth="5" />
          </svg>
          <span className="big">Cash</span>
          <span className="alt">Pay cash at the counter</span>
          <small>Take your order number, pay at the counter</small>
        </button>
      </div>
      {err && <div className="err">{err}</div>}
      <div className="note">Payment stuck? Ask at the counter.</div>
    </div>
  );
}
