import { getStore } from '@/lib/store';
import { fail, json } from '@/lib/server';

export const dynamic = 'force-dynamic';

// One order, for the kiosk's token screen and the customer's phone bill (the id is an unguessable uuid).
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const order = await getStore().getOrder(id);
    return order ? json(order) : json({ error: 'Order not found' }, 404);
  } catch (e) {
    return fail(e);
  }
}
