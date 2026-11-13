import { adminDenied, cleanText } from '@/lib/admin';
import { getStore } from '@/lib/store';
import { fail, isOrderId, json, notFound, readJson } from '@/lib/server';

export const dynamic = 'force-dynamic';

// Record a full refund of a paid order: { reason }. The money goes back outside the app (Paytm app, cash).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = adminDenied(req);
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    if (!isOrderId(id)) return notFound();
    const reason = cleanText((await readJson(req)).reason, 80, 'Reason');
    if (!reason) return json({ error: 'Pick a reason for the refund' }, 400);
    const store = getStore();
    const o = await store.refund(id, reason);
    await store.addEvent({ kind: 'refund', subject: `Order ${o.token}`, after: `₹${o.refundAmount}`, note: reason });
    return json(o);
  } catch (e) {
    return fail(e);
  }
}
