// English only (the owner asked for no Hindi). The menu lives in code for v1. Full menu prices: the launch
// discount was dropped (discount codes may come later, see docs/state.md).
// A price change is a one-line edit + deploy until the owner admin (M4) moves this into the DB.

// A section of the menu. Three come with the app ('dosa', 'idli', 'drinks'; 'test' is the ₹1 payment
// check); the owner can add more from the dashboard (ids like "s-ab12cd34"), rename, reorder and hide them.
export type CategoryId = string;

export interface Category {
  id: CategoryId;
  name: string;
  custom?: boolean; // added by the owner
  hidden?: boolean; // only in the owner's full view: the section and its dishes are off the kiosk
}

// How a choice reads on the kitchen chit: 'add' = more of something (green +), 'less' = less or none (red −).
export type Tone = 'add' | 'less';

export interface ModOption {
  id: string;
  name: string;
  price: number; // rupees added per unit
  tone?: Tone;
  custom?: boolean; // added by the owner
  hidden?: boolean; // only in the owner's full catalog: switched off, customers don't see it
}

export interface ModGroup {
  id: string;
  name: string;
  kind: 'one' | 'many'; // 'one' = pick exactly one (has a default), 'many' = optional extras
  defaultId?: string;
  options: ModOption[];
  custom?: boolean; // a set of extras the owner made
}

export interface MenuItem {
  id: string;
  cat: CategoryId;
  name: string;
  desc: string; // short homely line
  price: number;
  photo?: string; // /food/<id>.jpg
  special?: boolean;
  testOnly?: boolean; // only orderable while test mode is on (see lib/testmode.ts)
  placeholder?: string; // shown instead of a photo
  groups: string[]; // ModGroup ids
  notes: boolean; // kitchen notes allowed
  soldOut?: boolean; // set from the owner's dashboard for today only (see Catalog)
  custom?: boolean; // added by the owner from the dashboard (not in this file)
  // Only in the owner's full catalog (mergeCatalog(o, true)); the kiosk's catalog never contains these.
  hidden?: boolean; // taken off the menu by the owner; can be brought back
  draft?: boolean; // an owner-made dish that hasn't been published yet
}

export interface KitchenNote {
  id: string;
  label: string;
  tone?: Tone;
  items?: string[]; // only these items offer it (default: every item that takes notes)
  cats?: string[]; // a note the owner added: the sections whose dishes offer it
  custom?: boolean;
  hidden?: boolean; // only in the owner's full catalog
}

export const CATEGORIES: Category[] = [
  { id: 'dosa', name: 'Dosas' },
  { id: 'idli', name: 'Idli & Vada' },
  { id: 'drinks', name: 'Coffee & Tea' },
  { id: 'test', name: 'Payment test' }, // only has items in test mode
];

export const GROUPS: Record<string, ModGroup> = {
  dosaExtras: {
    id: 'dosaExtras',
    name: 'Make it extra',
    kind: 'many',
    options: [
      { id: 'benne', name: 'Extra benne', price: 25, tone: 'add' },
      { id: 'podi', name: 'Extra podi', price: 15, tone: 'add' },
      { id: 'palya', name: 'Extra stuffing', price: 30, tone: 'add' },
      { id: 'sambar', name: 'Extra sambhar', price: 20, tone: 'add' },
    ],
  },
  idliExtras: {
    id: 'idliExtras',
    name: 'Make it extra',
    kind: 'many',
    options: [
      { id: 'sambar', name: 'Extra sambhar', price: 20, tone: 'add' },
      { id: 'ghee', name: 'Extra ghee', price: 15, tone: 'add' },
    ],
  },
  sugar: {
    id: 'sugar',
    name: 'Sugar',
    kind: 'one',
    defaultId: 'regular',
    options: [
      { id: 'regular', name: 'Regular sugar', price: 0 },
      { id: 'less', name: 'Less sugar', price: 0, tone: 'less' },
      { id: 'none', name: 'No sugar', price: 0, tone: 'less' },
    ],
  },
};

const FRIED = ['ghee-podi-benne-dosa', 'masala-dosa', 'plain-benne-dosa', 'plain-dosa', 'medu-vada'];

export const NOTES: KitchenNote[] = [
  // Steamed idlis have no oil and can't be crisp: these two are for dosas and vada.
  { id: 'less-oil', label: 'Less oil', tone: 'less', items: FRIED },
  { id: 'extra-crisp', label: 'Extra crisp', tone: 'add', items: FRIED },
  { id: 'potato-side', label: 'Potato stuffing on the side', items: ['masala-dosa'] },
];

const dosa = ['dosaExtras'];
const idli = ['idliExtras'];

export const ITEMS: MenuItem[] = [
  // ₹1: GST on it rounds to ₹0, so it charges exactly ₹1: for checking real UPI payments end to end. Test mode only.
  {
    id: 'test-1',
    cat: 'test',
    name: 'Payment test',
    price: 1,
    groups: [],
    notes: false,
    testOnly: true,
    placeholder: '₹1',
    desc: 'Only for checking payments. Charges a real ₹1.',
  },
  {
    id: 'ghee-podi-benne-dosa',
    cat: 'dosa',
    name: 'Ghee Podi Benne Dosa',
    price: 199,
    special: true,
    groups: dosa,
    notes: true,
    desc: 'Brushed with ghee, rolled in podi, topped with a knob of butter. Bangalore taste, made with love.',
  },
  {
    id: 'masala-dosa',
    cat: 'dosa',
    name: 'Masala Dosa',
    price: 209,
    groups: dosa,
    notes: true,
    desc: 'Crisp outside, warm spiced potato inside. Just like home.',
  },
  {
    id: 'plain-benne-dosa',
    cat: 'dosa',
    name: 'Plain Benne Dosa',
    price: 159,
    groups: dosa,
    notes: true,
    desc: 'Soft centre, crisp edges and plenty of butter. The real taste of Bangalore.',
  },
  {
    id: 'plain-dosa',
    cat: 'dosa',
    name: 'Plain Dosa',
    price: 169,
    groups: dosa,
    notes: true,
    desc: 'Simple, golden and light. With coconut chutney and sambar.',
  },
  {
    id: 'mallige-idli',
    cat: 'idli',
    name: 'Mallige Idli',
    price: 89,
    groups: idli,
    notes: true,
    desc: "Soft as jasmine, with hot sambar. Have one, you'll want two more.",
  },
  {
    id: 'thatte-idli',
    cat: 'idli',
    name: 'Thatte Idli',
    price: 89,
    groups: idli,
    notes: true,
    desc: 'Big as a plate, soft as a cloud. With two chutneys.',
  },
  {
    id: 'ghee-podi-thatte-idli',
    cat: 'idli',
    name: 'Ghee Podi Thatte Idli',
    price: 109,
    groups: idli,
    notes: true,
    desc: "Soaked in ghee, coated in podi. It'll make your morning.",
  },
  {
    id: 'medu-vada',
    cat: 'idli',
    name: 'Udupi Medu Vada',
    price: 89,
    groups: idli,
    notes: true,
    desc: 'Crunchy outside, fluffy inside. Proper Udupi style.',
  },
  {
    id: 'filter-coffee',
    cat: 'drinks',
    name: 'Bengaluru Filter Coffee',
    price: 69,
    groups: ['sugar'],
    notes: false,
    placeholder: 'Coffee',
    desc: 'Frothy and hot in a steel dabara. A Bangalore morning in your hands.',
  },
  {
    id: 'masala-tea',
    cat: 'drinks',
    name: 'Masala Tea',
    price: 49,
    groups: ['sugar'],
    notes: false,
    desc: 'Ginger, cardamom and a pinch of clove. Chai that warms you up.',
  },
];

// Items with a real photo in /public/food. Filter coffee is waiting for the restaurant's own photo.
const PHOTOS = new Set(ITEMS.map((i) => i.id).filter((id) => id !== 'filter-coffee' && id !== 'test-1'));
export const placeholderOf = (id: string) => ITEMS.find((i) => i.id === id)?.placeholder ?? 'Coffee';
// The same two for a dish from a catalog, which may be one the owner added (its photo is a URL).
export const photoFor = (item: Pick<MenuItem, 'id' | 'photo'> | undefined) =>
  item ? (item.photo ?? photoOf(item.id)) : undefined;
export const placeholderFor = (item: Pick<MenuItem, 'id' | 'name' | 'placeholder' | 'custom'> | undefined) =>
  !item ? '' : item.custom ? item.name.split(' ').slice(0, 2).join(' ') : (item.placeholder ?? 'Coffee');
// Items the kiosk shows: test-only ones appear only in test mode.
export const visibleItems = (testMode: boolean, cat: Catalog) => cat.items.filter((i) => testMode || !i.testOnly);
export const photoOf = (id: string) => (PHOTOS.has(id) ? `/food/${id}.jpg` : undefined);

// ---- Catalog: the dishes above plus the owner's changes from the dashboard ----
// The dishes, groups and photos live in this file; the owner can change a dish's name, description,
// price and sold-out state, and the price of an extra. Those changes are stored in the database
// (menu_overrides / option_overrides) and merged on top here.
export interface ItemOverride {
  name?: string | null;
  desc?: string | null;
  price?: number | null;
  soldOut?: boolean;
}
// A dish the owner added from the dashboard. It lives in the database (menu_dishes), not in this file.
export interface CustomItem {
  id: string; // "c-" + random letters and digits
  cat: CategoryId; // any section but 'test'
  name: string;
  desc: string;
  price: number;
  groups: string[]; // ModGroup ids from GROUPS
  photo: string | null; // URL of the uploaded photo
  live: boolean; // false = draft, only the owner sees it
}
export const isCustomId = (id: unknown): id is string => typeof id === 'string' && /^c-[a-z0-9]{6,12}$/.test(id);

export const isSectionId = (id: unknown): id is string => typeof id === 'string' && /^s-[a-z0-9]{6,12}$/.test(id);
export const TEST_CAT = 'test';

// The owner's changes to the sections: their own sections, new names, the order, which are hidden.
export interface SectionsLayout {
  custom?: { id: string; name: string }[];
  names?: Record<string, string>; // section id → name the owner gave it
  order?: string[]; // section ids in the owner's order; the rest follow in their usual order
  hidden?: string[];
}
// The sections in order. `all` = the owner's view, hidden ones included and marked.
export function mergeSections(s: SectionsLayout | undefined, all = false): Category[] {
  const hidden = new Set(s?.hidden ?? []);
  const place = new Map((s?.order ?? []).map((id, n) => [id, n]));
  const own: Category[] = (s?.custom ?? []).map((c) => ({ id: c.id, name: c.name, custom: true }));
  return [...CATEGORIES.filter((c) => c.id !== TEST_CAT), ...own]
    .map((c, n) => {
      const out: Category = { ...c, name: s?.names?.[c.id] || c.name };
      if (hidden.has(c.id)) out.hidden = true;
      return { out, at: place.get(c.id) ?? 1e6 + n };
    })
    .sort((a, b) => a.at - b.at)
    .map((x) => x.out)
    .filter((c) => all || !c.hidden)
    .concat(CATEGORIES.filter((c) => c.id === TEST_CAT)); // the payment test always comes last
}

// The owner's changes to extras and kitchen notes (migration 0011). Ids the app makes: extras "x-…",
// sets of extras "g-…", notes "n-…". Nothing is ever deleted that an old order may point at: an
// extra or a note is switched off (hidden), so the kitchen still colours old chits correctly.
export interface ExtrasLayout {
  options?: Record<string, { id: string; name: string; price: number }[]>; // set id → the owner's extras in it
  names?: Record<string, string>; // "set:extra" → new name for an extra that came with the app
  hidden?: string[]; // "set:extra" switched off
  sets?: { id: string; name: string }[]; // sets of extras the owner made
  dishSets?: Record<string, string[]>; // a dish that came with the app → the sets it offers now
  notes?: { id: string; label: string; tone: Tone | null; cats: string[] }[];
  hiddenNotes?: string[];
}
export const isExtraId = (id: unknown): id is string => typeof id === 'string' && /^x-[a-z0-9]{6,12}$/.test(id);
export const isSetId = (id: unknown): id is string => typeof id === 'string' && /^g-[a-z0-9]{6,12}$/.test(id);
export const isNoteId = (id: unknown): id is string => typeof id === 'string' && /^n-[a-z0-9]{6,12}$/.test(id);

export interface Overrides {
  items: Record<string, ItemOverride>;
  options: Record<string, number>; // "group:option" → price
  custom?: CustomItem[]; // the owner's own dishes
  hidden?: string[]; // dish ids taken off the menu
  order?: string[]; // dish ids in the order the owner arranged them; the rest follow in their usual order
  sections?: SectionsLayout;
  extras?: ExtrasLayout;
}
export interface Catalog {
  cats: Category[]; // the sections, in order
  items: MenuItem[];
  groups: Record<string, ModGroup>;
  notes: KitchenNote[]; // every kitchen note; notesFor() picks the ones a dish offers
}

export const BASE_CATALOG: Catalog = { cats: CATEGORIES, items: ITEMS, groups: GROUPS, notes: NOTES };
export const optionKey = (groupId: string, optionId: string) => `${groupId}:${optionId}`;

// What customers can order: hidden dishes and drafts are left out, so the kiosk can't show them and
// the server can't price them. `all` = the owner's view, with those included and marked.
export function mergeCatalog(o: Overrides, all = false): Catalog {
  const own: MenuItem[] = (o.custom ?? []).map((c) => ({
    id: c.id,
    cat: c.cat,
    name: c.name,
    desc: c.desc,
    price: c.price,
    photo: c.photo ?? undefined,
    groups: c.groups,
    notes: c.cat === 'dosa' || c.cat === 'idli',
    custom: true,
    draft: !c.live,
  }));
  // Extras first: the dishes below are checked against the sets that exist.
  const ex = o.extras ?? {};
  const offOpt = new Set(ex.hidden ?? []);
  const groups: Record<string, ModGroup> = {};
  const build = (g: ModGroup) => {
    const mine: ModOption[] =
      g.kind === 'many'
        ? (ex.options?.[g.id] ?? []).map((c) => ({ id: c.id, name: c.name, price: c.price, tone: 'add', custom: true }))
        : [];
    const options = [
      ...g.options.map((op) => {
        const key = optionKey(g.id, op.id);
        return { ...op, name: ex.names?.[key] || op.name, price: o.options[key] ?? op.price };
      }),
      ...mine,
    ].map((op) => (g.kind === 'many' && offOpt.has(optionKey(g.id, op.id)) ? { ...op, hidden: true } : op));
    groups[g.id] = { ...g, options: options.filter((op) => all || !op.hidden) };
  };
  for (const g of Object.values(GROUPS)) build(g);
  for (const s of ex.sets ?? []) build({ id: s.id, name: s.name, kind: 'many', options: [], custom: true });
  // what a dish offers: sets that exist and, for customers, have something in them
  const sets = (ids: string[]) => ids.filter((g) => Object.hasOwn(groups, g) && (all || groups[g].options.length > 0));

  const offNote = new Set(ex.hiddenNotes ?? []);
  const notes: KitchenNote[] = [
    ...NOTES,
    ...(ex.notes ?? []).map((n): KitchenNote => ({
      id: n.id,
      label: n.label,
      tone: n.tone ?? undefined,
      cats: n.cats,
      custom: true,
    })),
  ]
    .map((n) => (offNote.has(n.id) ? { ...n, hidden: true } : n))
    .filter((n) => all || !n.hidden);

  const hidden = new Set(o.hidden ?? []);
  const place = new Map((o.order ?? []).map((id, n) => [id, n]));
  const cats = mergeSections(o.sections, all);
  const open = new Set(cats.map((c) => c.id)); // a dish in a hidden (or removed) section is off the menu too
  const items = [...ITEMS, ...own]
    .map((i, n) => {
      const x = o.items[i.id];
      const it: MenuItem = { ...i, groups: sets(i.custom ? i.groups : (ex.dishSets?.[i.id] ?? i.groups)) };
      if (hidden.has(i.id)) it.hidden = true;
      if (x) {
        it.soldOut = !!x.soldOut;
        if (!i.custom) Object.assign(it, { name: x.name || i.name, desc: x.desc || i.desc, price: x.price ?? i.price });
      }
      return { it, at: place.get(i.id) ?? 1e6 + n };
    })
    .sort((a, b) => a.at - b.at)
    .map((x) => x.it)
    .filter((i) => all || (!i.hidden && !i.draft && open.has(i.cat)));
  return { cats, items, groups, notes };
}

// Look a dish up in a catalog. Screens pass the catalog they loaded (components/Catalog.tsx); the
// server passes the merged one; the default is the menu in code.
export const itemById = (id: string, cat: Catalog = BASE_CATALOG) => cat.items.find((i) => i.id === id);

// Kitchen notes the item sheet offers for an item.
export const notesFor = (item: MenuItem, cat: Catalog = BASE_CATALOG) =>
  cat.notes.filter((n) =>
    n.custom
      ? !!n.cats?.includes(item.cat) // the owner said which sections take it
      : item.notes &&
        // a dosa the owner added is made on the tawa like the others: it takes the same two notes
        (!n.items || n.items.includes(item.id) || (item.custom && item.cat === 'dosa' && n.items === FRIED)),
  );

// Tone of a choice on an order, looked up by id so orders saved before tones existed still colour
// correctly. Pass the owner's full catalog to colour the owner's own extras and notes too.
export const optionTone = (groupId: string, id: string, cat: Catalog = BASE_CATALOG): Tone | undefined =>
  (cat.groups[groupId] ?? GROUPS[groupId])?.options.find((o) => o.id === id)?.tone;
export const noteTone = (id: string, cat: Catalog = BASE_CATALOG): Tone | undefined =>
  (cat.notes.find((n) => n.id === id) ?? NOTES.find((n) => n.id === id))?.tone;

// Shown as "Goes well with" in the item sheet. The cart's "Anything else?" is worked out per order (lib/suggest.ts).
export const PAIRING = 'filter-coffee';
