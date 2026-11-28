import { randomBytes } from 'node:crypto';
import { adminDenied, cleanPrice, cleanText } from '@/lib/admin';
import { TEST_CAT, mergeCatalog, mergeSections, type CustomItem, type SectionsLayout } from '@/lib/menu';
import type { AdminEvent } from '@/lib/orders';
import { getStore, type Store } from '@/lib/store';
import { BadRequest, fail, json, readJson } from '@/lib/server';

export const dynamic = 'force-dynamic';

const MAX_DISHES = 100;
const MAX_SECTIONS = 10; // what the kiosk's section bar holds comfortably
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
// { delete: id }    one of the owner's own dishes, draft or on the menu, removed for good (past orders keep it)
// { hide: id }      off the menu, kept for later      { show: id }     back on the menu
// { order: [ids] }  the dishes in the order the owner arranged them
// { section: { id?, name } }  add a section, or rename one   { removeSection: id, withDishes? }  one the owner added:
//     empty, or with withDishes its dishes too (only the owner's own dishes can go with it)
// { hideSection: id } / { showSection: id }  a section and its dishes off / back on the kiosk
// { sectionOrder: [ids] }  the sections in the owner's order
// { photo: { itemId, url } }  the owner's own photo for a dish that came with the app; url null = the original
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
    // every section the owner can put a dish in or change (never the payment test)
    const sections = mergeSections(o.sections, true).filter((c) => c.id !== TEST_CAT);
    const lay: SectionsLayout = o.sections ?? {};
    const known = mergeCatalog(o, true).groups; // the sets of extras a dish may offer, the owner's own included

    if (b.dish !== undefined) {
      const d = (b.dish ?? {}) as Record<string, unknown>;
      const was = d.id === undefined ? undefined : find(d.id);
      if (d.id !== undefined && !was) return json({ error: 'No such dish' }, 404);
      if (!was && custom.length >= MAX_DISHES) return json({ error: `At most ${MAX_DISHES} added dishes` }, 400);
      const name = cleanText(d.name, 40, 'Name');
      if (!name) return json({ error: 'The dish needs a name' }, 400);
      const price = cleanPrice(d.price, 'Price');
      if (price == null) return json({ error: 'Price must be a whole number of rupees above 0' }, 400);
      const cat = sections.find((c) => c.id === d.cat)?.id;
      if (!cat) return json({ error: 'Pick a section' }, 400);
      const groups = d.groups ?? [];
      if (
        !Array.isArray(groups) ||
        groups.length > 4 ||
        new Set(groups).size !== groups.length ||
        !groups.every((g) => typeof g === 'string' && Object.hasOwn(known, g))
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

    if (b.photo !== undefined) {
      const ph = b.photo as { itemId?: unknown; url?: unknown } | null;
      if (!ph || typeof ph !== 'object') return json({ error: 'Bad photo' }, 400);
      const it = all.find((i) => i.id === ph.itemId);
      if (!it) return json({ error: 'Unknown dish' }, 400);
      if (it.custom) return json({ error: 'Change this dish’s photo from its own sheet' }, 400);
      const url = cleanPhoto(ph.url, store);
      const photos = { ...(o.extras?.photos ?? {}) };
      if (url) photos[it.id] = url;
      else delete photos[it.id];
      await store.saveLayout(
        { extras: { ...(o.extras ?? {}), photos } },
        { kind: 'menu', subject: it.name, after: url ? 'New photo' : 'Back to the original photo' },
      );
      return json({});
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

    // What the menu's layout still says about dishes that are going: their place in the order, the
    // hidden list, their own extras and "comes with" line.
    const without = (ids: string[]) => {
      const gone = new Set(ids);
      const ex = o.extras ?? {};
      const keep = <T>(m?: Record<string, T>) =>
        Object.fromEntries(Object.entries(m ?? {}).filter(([k]) => !gone.has(k)));
      return {
        hidden: (o.hidden ?? []).filter((id) => !gone.has(id)),
        order: (o.order ?? []).filter((id) => !gone.has(id)),
        extras: { ...ex, dish: keep(ex.dish), comesWith: keep(ex.comesWith) },
      };
    };

    if (b.delete !== undefined) {
      const d = find(b.delete);
      if (!d) return json({ error: 'No such dish' }, 404); // a dish that came with the app can be hidden, not deleted
      await store.deleteDish(d.id, {
        kind: 'menu',
        subject: d.name,
        after: d.live ? 'Deleted from the menu' : 'Draft discarded',
      });
      await store.saveLayout(without([d.id]), null);
      return json({ deleted: d.id });
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

    if (b.section !== undefined) {
      const s = (b.section ?? {}) as Record<string, unknown>;
      const was = s.id === undefined ? undefined : sections.find((c) => c.id === s.id);
      if (s.id !== undefined && !was) return json({ error: 'No such section' }, 404);
      const name = cleanText(s.name, 24, 'Name');
      if (!name) return json({ error: 'The section needs a name' }, 400);
      if (sections.some((c) => c.id !== was?.id && c.name.toLowerCase() === name.toLowerCase()))
        return json({ error: `There is already a section called ${name}` }, 400);
      if (!was && sections.length >= MAX_SECTIONS) return json({ error: `At most ${MAX_SECTIONS} sections` }, 400);
      const id = was?.id ?? `s-${randomBytes(6).toString('hex').slice(0, 8)}`;
      const next: SectionsLayout = was?.custom
        ? { ...lay, custom: (lay.custom ?? []).map((c) => (c.id === id ? { id, name } : c)) }
        : was
          ? { ...lay, names: { ...lay.names, [id]: name } }
          : { ...lay, custom: [...(lay.custom ?? []), { id, name }] };
      if (was?.name !== name)
        await store.saveLayout(
          { sections: next },
          was
            ? { kind: 'name', subject: name, before: was.name, after: name }
            : { kind: 'menu', subject: name, after: 'New section' },
        );
      return json({ section: { id, name } });
    }

    if (b.removeSection !== undefined) {
      const s = sections.find((c) => c.id === b.removeSection);
      if (!s) return json({ error: 'No such section' }, 404);
      if (!s.custom) return json({ error: `${s.name} came with the app: hide it instead` }, 409);
      const inIt = mergeCatalog(o, true).items.filter((i) => i.cat === s.id);
      if (inIt.length && b.withDishes !== true)
        return json({ error: `Move or delete the dishes in ${s.name} first` }, 409);
      const theirs = inIt.find((i) => !i.custom);
      if (theirs) return json({ error: `${theirs.name} came with the app: move it before removing ${s.name}` }, 409);
      for (const i of inIt)
        await store.deleteDish(i.id, { kind: 'menu', subject: i.name, after: `Deleted with the section ${s.name}` });
      const drop = (ids?: string[]) => (ids ?? []).filter((id) => id !== s.id);
      await store.saveLayout(
        {
          ...(inIt.length ? without(inIt.map((i) => i.id)) : {}),
          sections: {
            ...lay,
            custom: (lay.custom ?? []).filter((c) => c.id !== s.id),
            order: drop(lay.order),
            hidden: drop(lay.hidden),
          },
        },
        { kind: 'menu', subject: s.name, after: 'Section removed' },
      );
      return json({ removed: s.id, dishes: inIt.length });
    }

    if (b.hideSection !== undefined || b.showSection !== undefined) {
      const hide = b.hideSection !== undefined;
      const s = sections.find((c) => c.id === (hide ? b.hideSection : b.showSection));
      if (!s) return json({ error: 'No such section' }, 404);
      const hidden = new Set(lay.hidden ?? []);
      if (hide && sections.filter((c) => !c.hidden).length <= 1 && !s.hidden)
        return json({ error: 'The kiosk needs at least one section' }, 409);
      if (hidden.has(s.id) !== hide) {
        if (hide) hidden.add(s.id);
        else hidden.delete(s.id);
        await store.saveLayout(
          { sections: { ...lay, hidden: [...hidden] } },
          { kind: 'menu', subject: s.name, after: hide ? 'Section hidden from the menu' : 'Section back on the menu' },
        );
      }
      return json({ hidden: [...hidden] });
    }

    if (b.sectionOrder !== undefined) {
      const ids = b.sectionOrder;
      const known = new Set(sections.map((c) => c.id));
      if (
        !Array.isArray(ids) ||
        ids.length > MAX_SECTIONS ||
        new Set(ids).size !== ids.length ||
        !ids.every((id) => typeof id === 'string' && known.has(id))
      )
        return json({ error: 'Bad order' }, 400);
      await store.saveLayout({ sections: { ...lay, order: ids as string[] } }, null);
      return json({ order: ids });
    }

    return json({ error: 'Nothing to change' }, 400);
  } catch (e) {
    return fail(e);
  }
}
