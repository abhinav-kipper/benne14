import { adminDenied, cleanPrice, cleanText } from '@/lib/admin';
import { BASE_CATALOG, GROUPS, itemById, mergeCatalog, optionKey } from '@/lib/menu';
import type { AdminEvent } from '@/lib/orders';
import { getStore } from '@/lib/store';
import { BadRequest, fail, json, readJson } from '@/lib/server';

export const dynamic = 'force-dynamic';

// One menu edit, saved together with its history lines:
// { itemId, name?, desc?, price?, soldOut?, options?: [{ groupId, optionId, price }] }
// null resets name/desc/price to the menu in code. An extra's price applies to every dish that offers it.
export async function POST(req: Request) {
  const denied = adminDenied(req);
  if (denied) return denied;
  try {
    const b = await readJson(req);
    const base = typeof b.itemId === 'string' ? itemById(b.itemId, BASE_CATALOG) : undefined;
    if (!base) return json({ error: 'Unknown dish' }, 400);
    if (b.soldOut !== undefined && typeof b.soldOut !== 'boolean')
      return json({ error: 'Sold out must be true or false' }, 400);
    const patch = {
      name: cleanText(b.name, 40, 'Name'),
      desc: cleanText(b.desc, 160, 'Description'),
      price: cleanPrice(b.price, 'Price'),
      soldOut: b.soldOut as boolean | undefined,
    };

    // Check every extra before anything is saved.
    if (b.options !== undefined && (!Array.isArray(b.options) || b.options.length > 20))
      return json({ error: 'Bad extras' }, 400);
    const options = ((b.options ?? []) as { groupId?: unknown; optionId?: unknown; price?: unknown }[]).map((o) => {
      const g = o && typeof o.groupId === 'string' && Object.hasOwn(GROUPS, o.groupId) ? GROUPS[o.groupId] : undefined;
      const op = g?.options.find((x) => x.id === o.optionId);
      if (!g || !op) throw new BadRequest('Unknown extra');
      if (g.kind !== 'many') throw new BadRequest('Only extras have prices');
      const price = cleanPrice(o.price, `${op.name} price`, 0);
      if (price == null) throw new BadRequest(`${op.name}: price must be a whole number of rupees`);
      return { groupId: g.id, optionId: op.id, name: op.name, price };
    });

    const store = getStore();
    const cat = mergeCatalog(await store.getOverrides());
    const before = itemById(base.id, cat)!;
    const after = {
      name: patch.name === undefined ? before.name : (patch.name ?? base.name),
      desc: patch.desc === undefined ? before.desc : (patch.desc ?? base.desc),
      price: patch.price === undefined ? before.price : (patch.price ?? base.price),
      soldOut: patch.soldOut === undefined ? !!before.soldOut : patch.soldOut,
    };
    // Change history: one line per thing that actually changes.
    const events: Omit<AdminEvent, 'at'>[] = [];
    if (before.price !== after.price)
      events.push({ kind: 'price', subject: after.name, before: `₹${before.price}`, after: `₹${after.price}` });
    if (before.name !== after.name)
      events.push({ kind: 'name', subject: after.name, before: before.name, after: after.name });
    if (before.desc !== after.desc)
      events.push({ kind: 'desc', subject: after.name, before: before.desc, after: after.desc });
    if (!!before.soldOut !== after.soldOut)
      events.push({ kind: after.soldOut ? 'sold_out' : 'back_on', subject: after.name });
    const changed = options.filter(
      (o) => cat.groups[o.groupId].options.find((x) => x.id === o.optionId)!.price !== o.price,
    );
    for (const o of changed) {
      const was = cat.groups[o.groupId].options.find((x) => x.id === o.optionId)!.price;
      events.push({
        kind: 'option_price',
        subject: o.name,
        before: `₹${was}`,
        after: `₹${o.price}`,
        note: optionKey(o.groupId, o.optionId),
      });
    }

    await store.saveMenuEdit({
      itemId: base.id,
      patch,
      options: changed.map(({ groupId, optionId, price }) => ({ groupId, optionId, price })),
      events,
    });
    return json({ ...before, ...after });
  } catch (e) {
    return fail(e);
  }
}
