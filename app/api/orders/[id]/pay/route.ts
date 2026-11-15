import { getStore } from '@/lib/store';
import { fail, isOrderId, json, notFound, paymentsAreMock } from '@/lib/server';

export const dynamic = 'force-dynamic';

// Mock payment confirmation for tests and demos (PAYMENTS=mock only). Real UPI is confirmed by
// settle() in lib/gateway.ts.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!paymentsAreMock()) return json({ error: 'Real payments are confirmed by the provider' }, 403);
  try {
    const { id } = await ctx.params;
    if (!isOrderId(id)) return notFound();
    const store = getStore();
    const order = await store.getOrder(id);
    if (!order) return json({ error: 'Order not found' }, 404);
    if (order.status !== 'pending_payment') return json(order);
    return json(await store.setStatus(id, 'new'));
  } catch (e) {
    return fail(e);
  }
}
