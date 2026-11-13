import { NEXT, type OrderStatus } from '@/lib/orders';
import { getStore } from '@/lib/store';
import { fail, isOrderId, json, notFound, readJson, staffCheck, staffDenied } from '@/lib/server';

export const dynamic = 'force-dynamic';

const ALLOWED: OrderStatus[] = ['new', 'cooking', 'ready', 'handed_over', 'cancelled'];

// Kitchen and counter: start, ready, handed over, undo, cash received (awaiting_cash → new).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const pin = staffCheck(req);
  if (pin !== 'ok') return staffDenied(pin);
  try {
    const { id } = await ctx.params;
    if (!isOrderId(id)) return notFound();
    const { to, from } = (await readJson(req)) as { to?: OrderStatus; from?: OrderStatus };
    if (typeof to !== 'string' || !ALLOWED.includes(to)) return json({ error: 'Bad status' }, 400);
    if (from !== undefined && (typeof from !== 'string' || !(from in NEXT))) return json({ error: 'Bad status' }, 400);
    return json(await getStore().setStatus(id, to, from));
  } catch (e) {
    return fail(e);
  }
}
