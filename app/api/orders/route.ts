import { priceOrder, type CartLine } from '@/lib/pricing';
import type { OrderType, PayMethod } from '@/lib/orders';
import { getStore } from '@/lib/store';
import { fail, json } from '@/lib/server';

export const dynamic = 'force-dynamic';

// Kiosk checkout. The body carries item ids and choices only; prices come from the server's menu.
export async function POST(req: Request) {
  try {
    const b = (await req.json()) as { key?: unknown; type?: unknown; name?: unknown; payMethod?: unknown; lines?: unknown };
    if (typeof b.key !== 'string' || b.key.length < 8 || b.key.length > 80) return json({ error: 'Missing checkout key' }, 400);
    if (b.type !== 'dine_in' && b.type !== 'takeaway') return json({ error: 'Pick dine-in or takeaway' }, 400);
    if (b.payMethod !== 'upi' && b.payMethod !== 'card' && b.payMethod !== 'cash') return json({ error: 'Pick a payment method' }, 400);
    if (!Array.isArray(b.lines) || b.lines.length > 40) return json({ error: 'Bad cart' }, 400);
    const name = typeof b.name === 'string' ? b.name.trim().slice(0, 24) || null : null;
    const priced = priceOrder(b.lines as CartLine[]);
    const order = await getStore().placeOrder({ key: b.key, type: b.type as OrderType, customerName: name, payMethod: b.payMethod as PayMethod, priced });
    return json(order, 201);
  } catch (e) {
    return fail(e);
  }
}

// Live orders for the kitchen and the board.
export async function GET() {
  try {
    return json(await getStore().listLive());
  } catch (e) {
    return fail(e);
  }
}
