'use client';
// The order number, what happens next, and the QR for the phone bill. Clears itself after 2 minutes.
import { useEffect, useState } from 'react';
import { useOrder } from '@/lib/client';
import type { Order } from '@/lib/orders';
import { orderedSentence } from '@/lib/wording';
import { DONE_GRACE_S, DONE_MORE_S, DONE_STAY_S } from './shared';

export function Done({ orderId, first, onDone }: { orderId: string; first: Order | null; onDone: () => void }) {
  const live = useOrder(orderId, 2000);
  const o = live ?? first;
  const [left, setLeft] = useState(DONE_STAY_S + DONE_GRACE_S);
  useEffect(() => {
    const t = setInterval(() => setLeft((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (left <= 0) onDone();
  }, [left, onDone]);
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);
  if (!o) return null;
  const atCounter = o.status === 'awaiting_cash';
  const stage = o.status === 'ready' || o.status === 'handed_over' ? 2 : o.status === 'cooking' ? 1 : 0;
  return (
    <div className="screen k-done">
      {atCounter && o.payMethod === 'upi' ? (
        <div className="paid due">
          <i>₹</i>Checking your UPI payment of ₹{o.total} at the counter
        </div>
      ) : atCounter ? (
        <div className="paid due">
          <i>₹</i>Pay ₹{o.total} at the counter · {o.payMethod === 'card' ? 'card machine' : 'cash'}
        </div>
      ) : (
        <div className="paid">
          <i>✓</i>Payment received · ₹{o.total} via {o.payMethod === 'upi' ? 'UPI' : o.payMethod}
        </div>
      )}
      <div className="thanks" data-testid="thanks">
        <h1>
          Thank you
          {o.customerName ? (
            <>
              , <b>{o.customerName}</b>
            </>
          ) : (
            ''
          )}
          !
        </h1>
        <p>{orderedSentence(o)}</p>
      </div>
      <div className="token" data-testid="token">
        <div className="tt">
          <span>Benne 14 · Order no.</span>
          <span>{o.type === 'dine_in' ? 'Dine-in' : 'Takeaway'}</span>
        </div>
        <div className="num">{o.token}</div>
        <div className="perf" />
        <div className="tb">
          <b>
            {o.customerName ? `${o.customerName} · ` : ''}
            {o.itemCount} {o.itemCount === 1 ? 'item' : 'items'}
          </b>
          <span>
            {/* what to do next is the sentence above the ticket; the stub only carries a fact */}
            {atCounter ? (o.payMethod === 'upi' ? `₹${o.total} · UPI` : `₹${o.total} to pay`) : 'Ready in ~8 min'}
          </span>
        </div>
      </div>
      <div className="watch">
        <svg viewBox="0 0 56 56" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round">
          <rect x="5" y="9" width="46" height="30" rx="4" />
          <path d="M20 47h16M28 39v8" />
          <path d="M15 24h8M28 24h13" strokeLinecap="round" />
        </svg>
        <div>
          <b>Watch the screen near the counter</b>We&apos;ll show number {o.token}
          {o.customerName ? ' and call your name' : ''} when it&apos;s ready.
        </div>
      </div>
      <div className="track">
        <div className="st done">
          <i>✓</i>
          <b>Order received</b>
        </div>
        <div className={`ln ${stage >= 1 ? 'on' : ''}`} />
        <div className={`st ${stage === 1 ? 'now' : stage > 1 ? 'done' : ''}`}>
          <i>{stage > 1 ? '✓' : ''}</i>
          <b>On the tawa</b>
        </div>
        <div className={`ln ${stage >= 2 ? 'on' : ''}`} />
        <div className={`st ${stage === 2 ? 'done' : ''}`}>
          <i>{stage === 2 ? '✓' : ''}</i>
          <b>Ready to collect</b>
        </div>
      </div>
      <div className="receipt">
        <div className="q">
          {origin && <img src={`/api/qr?u=${encodeURIComponent(`${origin}/r/${o.id}`)}`} alt="Scan for your bill" />}
        </div>
        <div>
          <h3 className="disp">Track &amp; bill on your phone</h3>
          <p>Scan to follow your order live and get the GST bill. No paper, no waiting.</p>
        </div>
      </div>
      <div className="reset">
        <span>Take your time. This screen clears by itself for the next customer.</span>
        <button onClick={onDone} data-testid="new-order">
          New order
        </button>
      </div>
      {/* The same "Still there?" box as on the menu, with a longer count and the order number repeated,
          because it covers the ticket while it asks. */}
      {left <= DONE_GRACE_S && (
        <div className="k-idle" data-testid="done-ask">
          <div className="box">
            <h2 className="disp">Still there?</h2>
            <p>
              Your order number is <b>{o.token}</b>. We&apos;ll clear this screen for the next customer in{' '}
              {Math.max(0, left)} seconds.
            </p>
            <div className="btns">
              <button className="no" onClick={onDone} data-testid="done-now">
                I&apos;m done
              </button>
              <button className="yes" onClick={() => setLeft(DONE_GRACE_S + DONE_MORE_S)} data-testid="more-time">
                I need more time
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
