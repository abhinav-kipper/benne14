'use client';
// Paying by card or cash at the counter, which is beside the kiosk. The kiosk waits here, with no
// order number, until staff say the money is in ("Paid" on the kitchen screen or the owner app): only
// then does the customer get their number and the kitchen the order. Staff's "Cancel", the customer's
// own, or a long silence drops the unpaid order instead.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, useOrder } from '@/lib/client';
import type { Order } from '@/lib/orders';
import { Idle } from './Idle';
import { BackChevron, COUNTER_GRACE_S, COUNTER_QUIET_MS } from './shared';

export function AtCounter({
  order,
  onPaid,
  onOther,
  onCancel,
}: {
  order: Order;
  onPaid: (paid: Order) => void; // staff confirmed: the order as it now stands
  onOther: () => void; // back to the ways to pay, with the same cart
  onCancel: () => void; // start again for the next customer
}) {
  const live = useOrder(order.id, 1500);
  const card = order.payMethod === 'card';
  const quietSince = useRef(Date.now());
  const [asking, setAsking] = useState(false);
  // Staff answered: paid moves on to the order number; their "Cancel" (not paid) goes back to the
  // ways to pay, so the customer can try another one.
  useEffect(() => {
    if (!live || live.status === 'awaiting_cash') return;
    if (live.status === 'cancelled') onOther();
    else onPaid(live);
  }, [live, onPaid, onOther]);
  useEffect(() => {
    const touch = () => {
      quietSince.current = Date.now();
    };
    window.addEventListener('pointerdown', touch);
    const t = setInterval(() => {
      if (Date.now() - quietSince.current > COUNTER_QUIET_MS) setAsking(true);
    }, 1000);
    return () => {
      window.removeEventListener('pointerdown', touch);
      clearInterval(t);
    };
  }, []);
  // Nothing was paid as far as the app knows: the order is dropped. (If staff tapped "Paid" in the
  // same moment, the server keeps it paid and this does nothing.)
  const drop = useCallback(
    (then: () => void) => {
      api.claim(order.id, 'cancel').catch(() => {});
      then();
    },
    [order.id],
  );
  const walkedAway = useCallback(() => drop(onCancel), [drop, onCancel]);
  return (
    <div className="screen k-upi k-atcounter" data-testid="at-counter" data-order={order.id}>
      <div className="bar">
        <button className="back" onClick={() => drop(onOther)} data-testid="counter-other">
          <span>
            <BackChevron />
          </span>
          Other ways to pay
        </button>
      </div>
      <h1 className="disp">{card ? 'Pay by card' : 'Pay cash'}</h1>
      <div className="sub">
        {card
          ? 'Tap or insert your card on the machine at the counter.'
          : `Please hand ₹${order.total} to the counter.`}
      </div>
      <div className="qrcard">
        <div className="how">
          {card ? (
            <svg
              viewBox="0 0 170 110"
              fill="none"
              stroke="currentColor"
              strokeWidth="6"
              strokeLinejoin="round"
              strokeLinecap="round"
            >
              <rect x="4" y="14" width="136" height="90" rx="12" />
              <rect x="22" y="36" width="30" height="22" rx="4" />
              <path d="M22 84h44M80 84h22" />
              <path d="M150 32c8 8 8 26 0 34M160 22c14 14 14 40 0 54" />
            </svg>
          ) : (
            <svg viewBox="0 0 170 110" fill="none" stroke="currentColor" strokeWidth="6" strokeLinejoin="round">
              <rect x="24" y="4" width="140" height="74" rx="8" opacity=".45" />
              <rect x="4" y="28" width="140" height="78" rx="8" fill="#FFFFFF" />
              <circle cx="74" cy="67" r="20" />
              <path d="M66 58h17M66 66h17M70 58c10 0 10 14 0 14l12 12" strokeLinecap="round" strokeWidth="5" />
            </svg>
          )}
          <b data-testid="counter-amount">₹{order.total}</b>
        </div>
        <div className="who">
          <div>
            <b>benne 14</b>
            <small>{card ? 'Card' : 'Cash'} · pay at the counter</small>
          </div>
        </div>
      </div>
      <div className="waitline" data-testid="counter-waiting">
        <i />
        Waiting for the counter to confirm your payment
      </div>
      <div className="apps">Your order number appears here as soon as they do.</div>
      <div className="foot">
        <span />
        <button onClick={() => drop(onCancel)} data-testid="counter-cancel">
          Cancel order
        </button>
      </div>
      {asking && (
        <Idle
          seconds={COUNTER_GRACE_S}
          text={(n) =>
            `Waiting for the counter to confirm ₹${order.total}. This order is cancelled and the screen clears in ${n} seconds.`
          }
          stay="I'm still paying"
          leave="Cancel order"
          onStay={() => {
            quietSince.current = Date.now();
            setAsking(false);
          }}
          onReset={walkedAway}
        />
      )}
    </div>
  );
}
