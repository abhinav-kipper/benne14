import { getStore } from '@/lib/store';
import { fail, isOrderId, json, notFound, readJson } from '@/lib/server';

export const dynamic = 'force-dynamic';

// From the kiosk, for an order still showing its UPI QR (no PIN: only the kiosk knows the order id):
//  - "paid": customer tapped "I've paid" → waits on the kitchen's payment shelf for staff to confirm
//  - "cancel": customer cancelled or the QR expired
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!isOrderId(id)) return notFound();
    const { action } = await readJson(req);
    if (action !== 'paid' && action !== 'cancel') return json({ error: 'Bad action' }, 400);
    const store = getStore();
    const order = await store.getOrder(id);
    if (!order) return json({ error: 'Order not found' }, 404);
    if (order.status !== 'pending_payment') return json(order); // already handled (e.g. staff confirmed first)
    return json(await store.setStatus(id, action === 'paid' ? 'awaiting_cash' : 'cancelled'));
  } catch (e) {
    return fail(e);
  }
}
