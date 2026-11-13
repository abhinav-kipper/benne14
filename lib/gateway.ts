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
}

export async function settle(orderId: string): Promise<Settled | null> {
  const cfg = easebuzzConfig();
  const store = getStore();
  const order = await store.getOrder(orderId);
  if (!order || !cfg) return order ? { order, state: isPaid(order) ? 'paid' : 'waiting' } : null;
  if (isPaid(order)) return { order, state: 'paid' };

  const txn = await fetchStatus(cfg, order.id);
  if (!txn || txn.state !== 'paid') return { order, state: txn?.state ?? 'waiting' };

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
