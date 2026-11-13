import { adminDenied, cleanPrice } from '@/lib/admin';
import { GROUPS, mergeCatalog, optionKey } from '@/lib/menu';
import { getStore } from '@/lib/store';
import { fail, json, readJson } from '@/lib/server';

export const dynamic = 'force-dynamic';

// Price of an extra: { groupId, optionId, price }. Applies to every dish that offers it.
export async function POST(req: Request) {
  const denied = adminDenied(req);
  if (denied) return denied;
  try {
    const b = await readJson(req);
    const g = typeof b.groupId === 'string' && Object.hasOwn(GROUPS, b.groupId) ? GROUPS[b.groupId] : undefined;
    const op = g?.options.find((o) => o.id === b.optionId);
    if (!g || !op) return json({ error: 'Unknown extra' }, 400);
    if (g.kind !== 'many') return json({ error: 'Only extras have prices' }, 400);
    const price = cleanPrice(b.price, 'Price', 0);
    if (price == null) return json({ error: 'Price must be a whole number of rupees' }, 400);
    const store = getStore();
    const was = mergeCatalog(await store.getOverrides()).groups[g.id].options.find((o) => o.id === op.id)!.price;
    await store.saveOptionPrice(g.id, op.id, price);
    if (was !== price) await store.addEvent({ kind: 'option_price', subject: op.name, before: `₹${was}`, after: `₹${price}`, note: optionKey(g.id, op.id) });
    return json({ groupId: g.id, optionId: op.id, price });
  } catch (e) {
    return fail(e);
  }
}
