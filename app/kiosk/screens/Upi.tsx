'use client';
// The UPI QR for this order, with a 5-minute timer and "I've paid".
import { useEffect, useState } from 'react';
import { api, useOrder } from '@/lib/client';
import type { Order } from '@/lib/orders';

export function Upi({
  order,
  mock,
  onPaid,
  onOther,
  onCancel,
}: {
  order: Order;
  mock: boolean;
  onPaid: () => void;
  onOther: () => void;
  onCancel: () => void;
}) {
  const live = useOrder(order.id, 1500);
  const [left, setLeft] = useState(300);
  const [claiming, setClaiming] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  // Staff may confirm on the soundbox before the customer taps: move on as soon as the order leaves pending.
  useEffect(() => {
    if (!live || live.status === 'pending_payment') return;
    if (live.status === 'cancelled') onCancel();
    else onPaid();
  }, [live, onPaid, onCancel]);
  // Release the order if the customer walks away or picks another way to pay.
  const drop = (then: () => void) => {
    api.claim(order.id, 'cancel').catch(() => {});
    then();
  };
  useEffect(() => {
    if (left === 0) drop(onCancel);
  }, [left]); // eslint-disable-line react-hooks/exhaustive-deps
  const paid = async () => {
    if (claiming) return;
    setClaiming(true);
    try {
      await api.claim(order.id, 'paid');
      onPaid();
    } catch {
      setClaiming(false);
    }
  };
  const mm = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  return (
    <div className="screen k-upi">
      <div className="bar">
        <button className="back" onClick={() => drop(onOther)}>
          <span>←</span>Other ways to pay
        </button>
        <div className="timer">
          QR valid for
          <div className="ring">
            <svg viewBox="0 0 64 64">
              <circle cx="32" cy="32" r="28" fill="none" stroke="#E2D8C7" strokeWidth="5" />
              <circle
                cx="32"
                cy="32"
                r="28"
                fill="none"
                stroke="#9C6A00"
                strokeWidth="5"
                strokeLinecap="round"
                strokeDasharray="176"
                strokeDashoffset={176 * (1 - left / 300)}
              />
            </svg>
            <b>{mm}</b>
          </div>
        </div>
      </div>
      <h1 className="disp">Scan &amp; pay</h1>
      <div className="sub">Open any UPI app, scan, done.</div>
      <div className="qrcard">
        <span className="corner c1" />
        <span className="corner c2" />
        <span className="corner c3" />
        <span className="corner c4" />
        <img src={`/api/orders/${order.id}/upi`} alt="UPI QR code" />
        <div className="who">
          <div>
            <b>Benne 14</b>
            <small>Order {order.token} · UPI</small>
          </div>
          <span>₹{order.total}</span>
        </div>
      </div>
      <div className="apps">Amount is filled in. Works with Google Pay, PhonePe, Paytm, BHIM or any UPI app</div>
      <div className="steps">
        <div>
          <b>1</b>Scan this QR<span>With any UPI app</span>
        </div>
        <div>
          <b>2</b>Enter UPI PIN<span>Amount is filled in</span>
        </div>
        <div>
          <b>3</b>Tap below<span>Get your order number</span>
        </div>
      </div>
      <button className="paidbtn" onClick={paid} disabled={claiming} data-testid="i-paid">
        <span>
          <b>{claiming ? 'Getting your order number…' : "I've paid"}</b>
          <span className="alt">Tap after paying</span>
        </span>
        <span className="arr">✓</span>
      </button>
      <div className="foot">
        <span>{mock ? 'Demo mode: no real money moves.' : 'Paid to Benne 14 · counter confirms on the soundbox'}</span>
        {mock && (
          <button className="sim" onClick={() => api.mockPay(order.id)} data-testid="simulate-paid">
            Simulate payment
          </button>
        )}
        <button onClick={() => drop(onCancel)}>Cancel order</button>
      </div>
    </div>
  );
}
