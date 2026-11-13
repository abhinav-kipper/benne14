import { adminDenied, cleanPrice, cleanText } from '@/lib/admin';
import { BASE_CATALOG, itemById, mergeCatalog } from '@/lib/menu';
import { getStore } from '@/lib/store';
import { fail, json, readJson } from '@/lib/server';

export const dynamic = 'force-dynamic';

// Change one dish: { itemId, name?, desc?, price?, soldOut? }. null resets name/desc/price to the menu in code.
export async function POST(req: Request) {
  const denied = adminDenied(req);
  if (denied) return denied;
  try {
    const b = await readJson(req);
    const base = typeof b.itemId === 'string' ? itemById(b.itemId, BASE_CATALOG) : undefined;
    if (!base) return json({ error: 'Unknown dish' }, 400);
    if (b.soldOut !== undefined && typeof b.soldOut !== 'boolean') return json({ error: 'Sold out must be true or false' }, 400);
    const patch = {
      name: cleanText(b.name, 40, 'Name'),
      desc: cleanText(b.desc, 160, 'Description'),
      price: cleanPrice(b.price, 'Price'),
      soldOut: b.soldOut as boolean | undefined,
    };
    const store = getStore();
    const before = itemById(base.id, mergeCatalog(await store.getOverrides()))!;
    await store.saveItem(base.id, patch);
    const after = itemById(base.id, mergeCatalog(await store.getOverrides()))!;
    // Change history: one line per thing that actually changed.
    const log = (kind: 'price' | 'name' | 'desc' | 'sold_out' | 'back_on', b4?: string, af?: string) => store.addEvent({ kind, subject: after.name, before: b4 ?? null, after: af ?? null });
    if (before.price !== after.price) await log('price', `₹${before.price}`, `₹${after.price}`);
    if (before.name !== after.name) await log('name', before.name, after.name);
    if (before.desc !== after.desc) await log('desc', before.desc, after.desc);
    if (!!before.soldOut !== !!after.soldOut) await log(after.soldOut ? 'sold_out' : 'back_on');
    return json(after);
  } catch (e) {
    return fail(e);
  }
}
