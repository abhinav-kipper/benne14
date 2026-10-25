import type { OrderStatus } from '@/lib/orders';
import { getStore } from '@/lib/store';
import { fail, json, staffOk } from '@/lib/server';

export const dynamic = 'force-dynamic';

const ALLOWED: OrderStatus[] = ['new', 'cooking', 'ready', 'handed_over', 'cancelled'];

// Kitchen and counter: start, ready, handed over, undo, cash received (awaiting_cash → new).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!staffOk(req)) return json({ error: 'Staff PIN needed' }, 401);
  try {
    const { id } = await ctx.params;
    const { to } = (await req.json()) as { to?: OrderStatus };
    if (!to || !ALLOWED.includes(to)) return json({ error: 'Bad status' }, 400);
    return json(await getStore().setStatus(id, to));
  } catch (e) {
    return fail(e);
  }
}
