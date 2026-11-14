import { randomBytes } from 'node:crypto';
import { adminDenied, cleanPrice, cleanText } from '@/lib/admin';
import { CUSTOM_CATS, GROUPS, mergeCatalog, type CustomItem } from '@/lib/menu';
import type { AdminEvent } from '@/lib/orders';
import { getStore, type Store } from '@/lib/store';
import { BadRequest, fail, json, readJson } from '@/lib/server';

export const dynamic = 'force-dynamic';

const MAX_DISHES = 100;
type Event = Omit<AdminEvent, 'at'>;

// The owner's whole menu, drafts and hidden dishes included (the public /api/menu leaves drafts out).
export async function GET(req: Request) {
  const denied = adminDenied(req);
  if (denied) return denied;
  try {
    return json(await getStore().getOverrides());
  } catch (e) {
    return fail(e);
  }
}

// A photo may only be one this app stored: the shop's own storage bucket (or, with no database, the
// in-memory stand-in). Never an address the owner's phone, or anyone else, made up.
function cleanPhoto(v: unknown, store: Store): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string') throw new BadRequest('Bad photo');
  if (store.kind === 'memory') {
    if (/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(v) && v.length < 1_500_000) return v;
  } else {
    const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/dish-photos/`;
    if (v.startsWith(base) && /^[\w./-]+\.jpg$/.test(v.slice(base.length)) && !v.includes('..') && v.length <= 400)
      return v;
  }
  throw new BadRequest('Upload the photo again');
}

// One change per request:
// { dish: { id?, cat, name, desc, price, groups, photo } }  add a dish (as a draft) or edit one
// { publish: id }   a draft goes on the menu          { discard: id }  a draft is thrown away
// { hide: id }      off the menu, kept for later      { show: id }     back on the menu
// { order: [ids] }  the dishes in the order the owner arranged them
export async function POST(req: Request) {
  const denied = adminDenied(req);
  if (denied) return denied;
  try {
    const b = await readJson(req);
    const store = getStore();
    const o = await store.getOverrides();
    const custom = o.custom ?? [];
    const all = mergeCatalog(o, true).items.filter((i) => !i.testOnly);
    const find = (id: unknown) => custom.find((c) => c.id === id);

    if (b.dish !== undefined) {
      const d = (b.dish ?? {}) as Record<string, unknown>;
      const was = d.id === undefined ? undefined : find(d.id);
      if (d.id !== undefined && !was) return json({ error: 'No such dish' }, 404);
      if (!was && custom.length >= MAX_DISHES) return json({ error: `At most ${MAX_DISHES} added dishes` }, 400);
      const name = cleanText(d.name, 40, 'Name');
      if (!name) return json({ error: 'The dish needs a name' }, 400);
      const price = cleanPrice(d.price, 'Price');
      if (price == null) return json({ error: 'Price must be a whole number of rupees above 0' }, 400);
      const cat = CUSTOM_CATS.find((c) => c === d.cat);
      if (!cat) return json({ error: 'Pick a section' }, 400);
      const groups = d.groups ?? [];
      if (
        !Array.isArray(groups) ||
        groups.length > 4 ||
        new Set(groups).size !== groups.length ||
        !groups.every((g) => typeof g === 'string' && Object.hasOwn(GROUPS, g))
      )
        return json({ error: 'Unknown extras' }, 400);
      if (all.some((i) => i.id !== was?.id && !i.hidden && i.name.toLowerCase() === name.toLowerCase()))
        return json({ error: `There is already a dish called ${name}` }, 400);
      const dish: CustomItem = {
        id: was?.id ?? `c-${randomBytes(6).toString('hex').slice(0, 10)}`,
        cat,
        name,
        desc: cleanText(d.desc, 160, 'Description') ?? '',
        price,
        groups: groups as string[],
        photo: cleanPhoto(d.photo, store),
        live: was?.live ?? false,
      };
      // History only for a dish customers can see: a draft is the owner's own scratch work.
      const events: Event[] = [];
      if (was?.live) {
        if (was.price !== dish.price)
          events.push({ kind: 'price', subject: dish.name, before: `₹${was.price}`, after: `₹${dish.price}` });
        if (was.name !== dish.name)
          events.push({ kind: 'name', subject: dish.name, before: was.name, after: dish.name });
        if (was.desc !== dish.desc)
          events.push({ kind: 'desc', subject: dish.name, before: was.desc, after: dish.desc });
        if (was.photo !== dish.photo) events.push({ kind: 'menu', subject: dish.name, after: 'New photo' });
      }
      await store.saveDish(dish, events[0] ?? null);
      for (const e of events.slice(1)) await store.addEvent(e);
      return json({ dish });
    }

    if (b.publish !== undefined) {
      const d = find(b.publish);
      if (!d) return json({ error: 'No such dish' }, 404);
      if (!d.live)
        await store.saveDish(
          { ...d, live: true },
          { kind: 'menu', subject: d.name, after: 'Added to the menu', note: `₹${d.price}` },
        );
      return json({ dish: { ...d, live: true } });
    }

    if (b.discard !== undefined) {
      const d = find(b.discard);
      if (!d) return json({ error: 'No such dish' }, 404);
      if (d.live) return json({ error: `${d.name} is on the menu: hide it instead` }, 409);
      await store.deleteDish(d.id, { kind: 'menu', subject: d.name, after: 'Draft discarded' });
      return json({ discarded: d.id });
    }

    if (b.hide !== undefined || b.show !== undefined) {
      const hide = b.hide !== undefined;
      const it = all.find((i) => i.id === (hide ? b.hide : b.show));
      if (!it) return json({ error: 'No such dish' }, 404);
      if (it.draft) return json({ error: `${it.name} is a draft: it is not on the menu yet` }, 409);
      const hidden = new Set(o.hidden ?? []);
      if (hidden.has(it.id) !== hide) {
        if (hide) hidden.add(it.id);
        else hidden.delete(it.id);
        await store.saveLayout(
          { hidden: [...hidden] },
          { kind: 'menu', subject: it.name, after: hide ? 'Hidden from the menu' : 'Back on the menu' },
        );
      }
      return json({ hidden: [...hidden] });
    }

    if (b.order !== undefined) {
      const ids = b.order;
      const known = new Set(all.map((i) => i.id));
      if (
        !Array.isArray(ids) ||
        ids.length > 400 ||
        new Set(ids).size !== ids.length ||
        !ids.every((id) => typeof id === 'string' && known.has(id))
      )
        return json({ error: 'Bad order' }, 400);
      await store.saveLayout({ order: ids as string[] }, null);
      return json({ order: ids });
    }

    return json({ error: 'Nothing to change' }, 400);
  } catch (e) {
    return fail(e);
  }
}
