'use client';
// The right-hand column: payments to collect at the counter, then orders ready to hand over.
import { useLayoutEffect, useRef, useState } from 'react';
import { minutesSince, type Order, type OrderStatus } from '@/lib/orders';
import { Bag, Bell, Check, Dine, Hand, Rupee } from './icons';

export function Pass({
  due,
  ready,
  now,
  isFresh,
  onMove,
}: {
  due: Order[];
  ready: Order[];
  now: number;
  isFresh: (o: Order) => boolean;
  onMove: (o: Order, to: OrderStatus, undoable?: boolean) => void;
}) {
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);

  // Shelf density: when the payment + ready cards don't fit the column, step down to smaller cards
  // (1 compact, 2 one-line rows, 3 two per row) so the oldest ready orders stay on screen.
  // It starts again from full size whenever the number of cards changes.
  const passRef = useRef<HTMLDivElement>(null);
  const shelfKey = `${due.length}:${ready.length}`;
  const [fit, setFit] = useState({ key: shelfKey, level: 0 });
  const density = fit.key === shelfKey ? fit.level : 0;
  useLayoutEffect(() => {
    const el = passRef.current;
    if (el && density < 3 && el.scrollHeight > el.clientHeight + 1) setFit({ key: shelfKey, level: density + 1 });
  }, [shelfKey, density]);

  return (
    <div className={`pass d${density}`} ref={passRef} data-testid="pass" data-density={density}>
      {due.length > 0 && (
        <>
          <div className="pass-h due">
            <Rupee />
            <b>Collect payment</b>
            <span>{due.length}</span>
          </div>
          <div className="shelf">
            {due.map((o) => (
              <div
                className={`plate due ${o.status === 'pending_payment' ? 'open' : ''} ${isFresh(o) ? 'fresh' : ''}`}
                key={o.id}
                data-testid={`due-${o.token}`}
              >
                <div className="row1">
                  <span className="tok">{o.token}</span>
                  {o.type === 'dine_in' ? <Dine /> : <Bag />}
                  <span className="w amt">₹{o.total}</span>
                </div>
                <div className="nm2">
                  <b className="how">
                    {o.payMethod === 'upi'
                      ? o.status === 'pending_payment'
                        ? 'UPI · QR still open'
                        : 'UPI · listen for the soundbox'
                      : o.payMethod === 'card'
                        ? 'Card machine'
                        : 'Cash'}
                  </b>
                  {o.customerName ? ` · ${o.customerName}` : ''} · {o.itemCount} {o.itemCount === 1 ? 'item' : 'items'}
                </div>
                <div className="pay-actions">
                  <button onClick={() => onMove(o, 'new', false)}>
                    <Check />
                    Paid
                  </button>
                  <button
                    className="drop"
                    onClick={() => {
                      if (confirmCancel === o.id) {
                        setConfirmCancel(null);
                        onMove(o, 'cancelled', false);
                      } else setConfirmCancel(o.id);
                    }}
                  >
                    {confirmCancel === o.id ? 'Sure?' : 'Cancel'}
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="gap" />
        </>
      )}
      <div className="pass-h">
        <Bell />
        <b>Ready at counter</b>
        <span>{ready.length}</span>
      </div>
      <div className="shelf">
        {ready.map((o) => {
          const w = o.readyAt ? minutesSince(o.readyAt, now) : 0;
          return (
            <div className={`plate ${isFresh(o) ? 'fresh' : ''}`} key={o.id} data-testid={`ready-${o.token}`}>
              <div className="row1">
                <span className="tok">{o.token}</span>
                {o.type === 'dine_in' ? <Dine /> : <Bag />}
                <span className="w">
                  <i className={w >= 3 ? 'long' : ''} />
                  {w} min
                </span>
              </div>
              <div className="nm2">
                {o.customerName ? `${o.customerName} · ` : ''}
                {o.lines.map((l) => `${l.qty} × ${l.name}`).join(', ')}
              </div>
              <button onClick={() => onMove(o, 'handed_over')} aria-label={`Order ${o.token} handed over`}>
                <Hand />
                <span className="lbl">Handed over</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
