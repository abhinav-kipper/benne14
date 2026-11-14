import { randomBytes } from 'node:crypto';
import { adminDenied, cleanPrice, cleanText } from '@/lib/admin';
import { TEST_CAT, mergeCatalog, mergeSections, optionKey, type ExtrasLayout, type Tone } from '@/lib/menu';
import { getStore } from '@/lib/store';
import { fail, json, readJson } from '@/lib/server';

export const dynamic = 'force-dynamic';

const MAX_PER_SET = 12; // extras in one set: what the kiosk's dish sheet shows without a long scroll
const MAX_SETS = 8;
const MAX_NOTES = 12;
const newId = (prefix: string) => `${prefix}-${randomBytes(6).toString('hex').slice(0, 8)}`;

// Extras and kitchen notes, one change per request:
// { extra: { set, id?, name, price } }   add an extra to a set, or change one's name and price
// { hideExtra: "set:extra" } / { showExtra: "set:extra" }   off / back on the kiosk
// { set: { id?, name } }   a new set of extras, or a new name for one the owner made
// { removeSet: id }        an owner-made set with no extras that no dish offers
// { dishSets: { itemId, sets: [ids] } }   which sets a dish that came with the app offers
// { note: { id?, label, tone, cats } }    a new kitchen note, or a change to one the owner made
// { hideNote: id } / { showNote: id }
// Nothing an old order may point at is deleted: extras and notes are switched off instead.
export async function POST(req: Request) {
  const denied = adminDenied(req);
  if (denied) return denied;
  try {
    const b = await readJson(req);
    const store = getStore();
    const o = await store.getOverrides();
    const cat = mergeCatalog(o, true);
    const ex: ExtrasLayout = o.extras ?? {};
    const save = (next: ExtrasLayout, subject: string, after: string, before?: string) =>
      store.saveLayout({ extras: next }, { kind: 'menu', subject, before: before ?? null, after });
    const extraSets = Object.values(cat.groups).filter((g) => g.kind === 'many'); // the sets extras live in

    if (b.extra !== undefined) {
      const x = (b.extra ?? {}) as Record<string, unknown>;
      const set = extraSets.find((g) => g.id === x.set);
      if (!set) return json({ error: 'No such set of extras' }, 404);
      const was = x.id === undefined ? undefined : set.options.find((op) => op.id === x.id);
      if (x.id !== undefined && !was) return json({ error: 'No such extra' }, 404);
      const name = cleanText(x.name, 30, 'Name');
      if (!name) return json({ error: 'The extra needs a name' }, 400);
      const price = cleanPrice(x.price, 'Price', 0);
      if (price == null) return json({ error: 'Price must be a whole number of rupees (0 for free)' }, 400);
      if (set.options.some((op) => op.id !== was?.id && op.name.toLowerCase() === name.toLowerCase()))
        return json({ error: `There is already an extra called ${name}` }, 400);
      if (!was && set.options.length >= MAX_PER_SET)
        return json({ error: `At most ${MAX_PER_SET} extras in a set` }, 400);

      if (was && !was.custom) {
        // An extra that came with the app: its price lives with the other price changes, its name here.
        if (was.price !== price)
          await store.saveMenuEdit({
            itemId: '',
            patch: {},
            options: [{ groupId: set.id, optionId: was.id, price }],
            events: [
              {
                kind: 'option_price',
                subject: name,
                before: `₹${was.price}`,
                after: `₹${price}`,
                note: optionKey(set.id, was.id),
              },
            ],
          });
        if (was.name !== name)
          await store.saveLayout(
            { extras: { ...ex, names: { ...ex.names, [optionKey(set.id, was.id)]: name } } },
            { kind: 'name', subject: name, before: was.name, after: name },
          );
        return json({ extra: { set: set.id, id: was.id, name, price } });
      }
      const id = was?.id ?? newId('x');
      const mine = ex.options?.[set.id] ?? [];
      const next = was ? mine.map((c) => (c.id === id ? { id, name, price } : c)) : [...mine, { id, name, price }];
      if (!was || was.name !== name || was.price !== price)
        await save(
          { ...ex, options: { ...ex.options, [set.id]: next } },
          name,
          was ? `₹${price}` : `New extra · ₹${price}`,
          was ? `${was.name} · ₹${was.price}` : undefined,
        );
      return json({ extra: { set: set.id, id, name, price } });
    }

    if (b.hideExtra !== undefined || b.showExtra !== undefined) {
      const hide = b.hideExtra !== undefined;
      const key = hide ? b.hideExtra : b.showExtra;
      const set = extraSets.find((g) => typeof key === 'string' && key.startsWith(`${g.id}:`));
      const op = set?.options.find((x) => optionKey(set.id, x.id) === key);
      if (!set || !op) return json({ error: 'No such extra' }, 404);
      const hidden = new Set(ex.hidden ?? []);
      if (hidden.has(key as string) !== hide) {
        if (hide) hidden.add(key as string);
        else hidden.delete(key as string);
        await save({ ...ex, hidden: [...hidden] }, op.name, hide ? 'Extra switched off' : 'Extra back on');
      }
      return json({ hidden: [...hidden] });
    }

    if (b.set !== undefined) {
      const s = (b.set ?? {}) as Record<string, unknown>;
      const was = s.id === undefined ? undefined : extraSets.find((g) => g.id === s.id);
      if (s.id !== undefined && !was) return json({ error: 'No such set of extras' }, 404);
      if (was && !was.custom) return json({ error: 'This set came with the app: its name stays' }, 409);
      const name = cleanText(s.name, 24, 'Name');
      if (!name) return json({ error: 'The set needs a name' }, 400);
      const mine = ex.sets ?? [];
      if (mine.some((g) => g.id !== was?.id && g.name.toLowerCase() === name.toLowerCase()))
        return json({ error: `There is already a set called ${name}` }, 400);
      if (!was && mine.length >= MAX_SETS) return json({ error: `At most ${MAX_SETS} sets of your own` }, 400);
      const id = was?.id ?? newId('g');
      const next = was ? mine.map((g) => (g.id === id ? { id, name } : g)) : [...mine, { id, name }];
      if (was?.name !== name) await save({ ...ex, sets: next }, name, was ? name : 'New set of extras', was?.name);
      return json({ set: { id, name } });
    }

    if (b.removeSet !== undefined) {
      const set = extraSets.find((g) => g.id === b.removeSet);
      if (!set) return json({ error: 'No such set of extras' }, 404);
      if (!set.custom) return json({ error: 'This set came with the app' }, 409);
      if (set.options.length) return json({ error: 'A set with extras stays: old orders may show them' }, 409);
      if (cat.items.some((i) => i.groups.includes(set.id)))
        return json({ error: `A dish still offers ${set.name}` }, 409);
      const options = { ...ex.options };
      delete options[set.id];
      await save({ ...ex, sets: (ex.sets ?? []).filter((g) => g.id !== set.id), options }, set.name, 'Set removed');
      return json({ removed: set.id });
    }

    if (b.dishSets !== undefined) {
      const d = (b.dishSets ?? {}) as Record<string, unknown>;
      const item = cat.items.find((i) => i.id === d.itemId && !i.testOnly);
      if (!item) return json({ error: 'No such dish' }, 404);
      if (item.custom) return json({ error: 'Edit this dish from its own sheet' }, 400);
      const sets = d.sets;
      if (
        !Array.isArray(sets) ||
        sets.length > 4 ||
        new Set(sets).size !== sets.length ||
        !sets.every((g) => typeof g === 'string' && Object.hasOwn(cat.groups, g))
      )
        return json({ error: 'Unknown extras' }, 400);
      if (JSON.stringify(sets) !== JSON.stringify(item.groups))
        await save(
          { ...ex, dishSets: { ...ex.dishSets, [item.id]: sets as string[] } },
          item.name,
          sets.length ? `Offers: ${(sets as string[]).map((g) => cat.groups[g].name).join(', ')}` : 'Offers no extras',
        );
      return json({ itemId: item.id, sets });
    }

    if (b.note !== undefined) {
      const n = (b.note ?? {}) as Record<string, unknown>;
      const mine = ex.notes ?? [];
      const was = n.id === undefined ? undefined : mine.find((x) => x.id === n.id);
      if (n.id !== undefined && !was) return json({ error: 'No such note of your own' }, 404);
      const label = cleanText(n.label, 30, 'Note');
      if (!label) return json({ error: 'The note needs some words' }, 400);
      const tone = n.tone === 'add' || n.tone === 'less' ? (n.tone as Tone) : n.tone == null ? null : undefined;
      if (tone === undefined) return json({ error: 'Bad kind of note' }, 400);
      const known = new Set(mergeSections(o.sections, true).map((c) => c.id));
      known.delete(TEST_CAT);
      const cats = n.cats;
      if (
        !Array.isArray(cats) ||
        !cats.length ||
        new Set(cats).size !== cats.length ||
        !cats.every((c) => typeof c === 'string' && known.has(c))
      )
        return json({ error: 'Pick at least one section for the note' }, 400);
      if (cat.notes.some((x) => x.id !== was?.id && x.label.toLowerCase() === label.toLowerCase()))
        return json({ error: `There is already a note “${label}”` }, 400);
      if (!was && mine.length >= MAX_NOTES) return json({ error: `At most ${MAX_NOTES} notes of your own` }, 400);
      const note = { id: was?.id ?? newId('n'), label, tone, cats: cats as string[] };
      const next = was ? mine.map((x) => (x.id === note.id ? note : x)) : [...mine, note];
      if (JSON.stringify(was) !== JSON.stringify(note))
        await save({ ...ex, notes: next }, label, was ? 'Kitchen note changed' : 'New kitchen note', was?.label);
      return json({ note });
    }

    if (b.hideNote !== undefined || b.showNote !== undefined) {
      const hide = b.hideNote !== undefined;
      const note = cat.notes.find((x) => x.id === (hide ? b.hideNote : b.showNote));
      if (!note) return json({ error: 'No such note' }, 404);
      const hidden = new Set(ex.hiddenNotes ?? []);
      if (hidden.has(note.id) !== hide) {
        if (hide) hidden.add(note.id);
        else hidden.delete(note.id);
        await save(
          { ...ex, hiddenNotes: [...hidden] },
          note.label,
          hide ? 'Kitchen note switched off' : 'Kitchen note back on',
        );
      }
      return json({ hiddenNotes: [...hidden] });
    }

    return json({ error: 'Nothing to change' }, 400);
  } catch (e) {
    return fail(e);
  }
}
