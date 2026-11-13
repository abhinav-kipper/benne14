'use client';
// The UPI QR for this order, with a 5-minute timer. With a payment gateway (Easebuzz) the payment
// confirms itself and the screen moves on; without one the customer taps "I've paid" and staff confirm.
import { useEffect, useState } from 'react';
import { api, useOrder, usePoll, type GatewayView } from '@/lib/client';
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
  // How to show the payment: asked once per order. null while asking; 'direct' if the gateway is off
  // or didn't answer, so there is always a way to pay.
  const [view, setView] = useState<GatewayView | null>(null);
  const [trouble, setTrouble] = useState<'failed' | 'problem' | null>(null);
  useEffect(() => {
    let live = true;
    api
      .gatewayStart(order.id)
      .then((v) => live && setView(v))
      .catch(() => live && setView({ kind: 'direct' }));
    return () => {
      live = false;
    };
  }, [order.id]);
  const auto = view !== null && view.kind !== 'direct'; // the gateway tells us when it is paid
  // Ask the gateway every few seconds; when it says paid, the order changes and the effect below moves on.
  usePoll(
    async () => {
      const r = await api.gatewayCheck(order.id);
      setTrouble(r.state === 'failed' || r.state === 'problem' ? r.state : null);
    },
    3000,
    auto,
  );
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
      <div className="sub">
        {view?.kind === 'page'
          ? `Tap “Pay by QR”, then “Pay ₹${order.total}”, and scan with any UPI app.`
          : 'With Google Pay, PhonePe, Paytm, BHIM or any UPI app.'}
      </div>
      {view?.kind === 'page' && (
        // the gateway's own payment page (until it lets us draw the QR ourselves)
        <div className="gateway" data-testid="gateway-page">
          <div className="frame">
            <iframe src={view.url} title="Pay by UPI" />
          </div>
        </div>
      )}
      <div className="qrcard" hidden={view?.kind === 'page'}>
        <span className="corner c1" />
        <span className="corner c2" />
        <span className="corner c3" />
        <span className="corner c4" />
        {view === null ? (
          <div className="qrwait">Getting your QR…</div>
        ) : view.kind === 'qr' ? (
          <div className="qrsvg" data-testid="gateway-qr" dangerouslySetInnerHTML={{ __html: view.svg }} />
        ) : view.kind === 'direct' ? (
          <img src={`/api/orders/${order.id}/upi`} alt="UPI QR code" />
        ) : null}
        <div className="who">
          <div>
            <b>Benne 14</b>
            <small>Order {order.token} · UPI</small>
          </div>
          <span>₹{order.total}</span>
        </div>
      </div>
      {auto ? (
        <>
          <div className="apps">The amount is filled in. Nothing to tap after paying.</div>
          {trouble ? (
            <div className="waitline bad" data-testid="pay-trouble">
              {trouble === 'failed'
                ? 'That payment didn’t go through. Try another way to pay.'
                : 'We received a payment we couldn’t match to this order. Please ask at the counter.'}
            </div>
          ) : (
            <div className="waitline" data-testid="pay-waiting">
              <i />
              Waiting for your payment. Your order number comes up by itself.
            </div>
          )}
        </>
      ) : (
        <>
          <div className="apps">The amount is filled in. Pay in your app, then tap below.</div>
          <button className="paidbtn" onClick={paid} disabled={claiming || view === null} data-testid="i-paid">
            <span>
              <b>{claiming ? 'Getting your order number…' : "I've paid"}</b>
              <span className="alt">Tap after paying</span>
            </span>
            <span className="arr">✓</span>
          </button>
        </>
      )}
      <div className="foot">
        <span>
          {mock
            ? 'Demo mode: no real money moves.'
            : auto
              ? 'Paid to Benne 14 · confirmed automatically'
              : 'Paid to Benne 14 · counter confirms on the soundbox'}
        </span>
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
