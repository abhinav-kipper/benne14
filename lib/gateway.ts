// What happens when a gateway (Easebuzz) reports on an order's payment. One function decides,
// whichever way the news arrived (Easebuzz's webhook, or our own status check while the QR is on
// screen), and it always asks Easebuzz directly: a message alone is never trusted.
import 'server-only';
import { easebuzzConfig, fetchStatus, type PayState } from './easebuzz';
import { isPaid, type Order } from './orders';
import { getStore } from './store';
import { StoreError } from './store/memory';

export interface Settled {
  order: Order;
  // paid: the order is paid (now or already). failed: this payment attempt is over without money.
  // waiting: nothing yet. problem: money arrived but the order can't take it (see the change history).
  state: PayState | 'problem';
  // Easebuzz's own word for where the payment is: 'initiated' (their page is open), 'pending' (the QR
  // is on screen), 'success'… Lets the kiosk know the customer has reached the QR.
  gatewayStatus?: string;
}

export async function settle(orderId: string): Promise<Settled | null> {
  const cfg = easebuzzConfig();
  const store = getStore();
  const order = await store.getOrder(orderId);
  if (!order || !cfg) return order ? { order, state: isPaid(order) ? 'paid' : 'waiting' } : null;
  if (isPaid(order)) return { order, state: 'paid' };

  const txn = await fetchStatus(cfg, order.id);
  if (!txn || txn.state !== 'paid') return { order, state: txn?.state ?? 'waiting', gatewayStatus: txn?.status };

  // Easebuzz says the money arrived. It must be this order's exact amount, and carry a reference.
  const note = (why: string) =>
    `₹${txn.amount} via Easebuzz ${txn.ref ?? '(no reference)'}${txn.bankRef ? ` · UPI ref ${txn.bankRef}` : ''}: ${why}`;
  const flag = async (why: string) => {
    // once per payment: webhooks are retried and the kiosk checks every few seconds
    const seen = (await store.listEvents(200)).some(
      (e) => e.kind === 'payment' && e.note?.includes(txn.ref ?? '\u0000'),
    );
    if (!seen) await store.addEvent({ kind: 'payment', subject: `Order ${order.token}`, note: note(why) });
    return { order, state: 'problem' as const };
  };
  if (!txn.ref) return flag('no payment reference, not accepted');
  if (txn.amount !== order.total)
    return flag(`the order is ₹${order.total}, so it was not marked paid. Check and refund`);
  try {
    const paid = await store.confirmPayment(order.id, { gateway: 'easebuzz', ref: txn.ref, bankRef: txn.bankRef });
    return { order: paid, state: 'paid' };
  } catch (e) {
    // paid after the order was cancelled (the customer scanned an old QR): the money needs to go back
    if (e instanceof StoreError && e.status === 409) return flag('paid after the order was cancelled. Refund it');
    throw e;
  }
}

// A customer may pay after the kiosk has moved on (they walked off mid-payment, then finished in
// their app). The kiosk no longer asks, and the webhook can be lost, so the screens that are always
// on do it: whenever the kitchen or TV fetches the live orders, each UPI order still waiting for its
// payment is checked with the gateway, at most once every CHECK_EVERY_MS per order.
const CHECK_EVERY_MS = 15_000;
const lastCheck = new Map<string, number>();
export function ordersToRecheck(orders: Pick<Order, 'id' | 'status' | 'payMethod'>[], now = Date.now()): string[] {
  if (!easebuzzConfig()) return [];
  const due = orders
    .filter((o) => o.status === 'pending_payment' && o.payMethod === 'upi')
    .filter((o) => now - (lastCheck.get(o.id) ?? 0) >= CHECK_EVERY_MS)
    .map((o) => o.id);
  for (const id of due) lastCheck.set(id, now);
  if (lastCheck.size > 2000) for (const k of [...lastCheck.keys()].slice(0, 1000)) lastCheck.delete(k); // bound memory
  return due;
}
export async function recheck(ids: string[]) {
  for (const id of ids) {
    try {
      await settle(id);
    } catch (e) {
      console.error('Could not recheck a waiting payment', e); // tried again on a later poll
    }
  }
}
