// English only (the owner asked for no Hindi). The menu lives in code for v1. Full menu prices: the launch
// discount was dropped (discount codes may come later, see docs/state.md).
// A price change is a one-line edit + deploy until the owner admin (M4) moves this into the DB.

export type CategoryId = 'dosa' | 'idli' | 'drinks' | 'test';

export interface Category {
  id: CategoryId;
  name: string;
}

// How a choice reads on the kitchen chit: 'add' = more of something (green +), 'less' = less or none (red −).
export type Tone = 'add' | 'less';

export interface ModOption {
  id: string;
  name: string;
  price: number; // rupees added per unit
  tone?: Tone;
}

export interface ModGroup {
  id: string;
  name: string;
  kind: 'one' | 'many'; // 'one' = pick exactly one (has a default), 'many' = optional extras
  defaultId?: string;
  options: ModOption[];
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
}

export interface KitchenNote {
  id: string;
  label: string;
  tone?: Tone;
  items?: string[]; // only these items offer it (default: every item that takes notes)
}

export const CATEGORIES: Category[] = [
  { id: 'dosa', name: 'Dosas' },
  { id: 'idli', name: 'Idli & Vada' },
  { id: 'drinks', name: 'Coffee & Tea' },
  { id: 'test', name: 'Payment test' }, // only has items in test mode
];

export const GROUPS: Record<string, ModGroup> = {
  dosaExtras: {
    id: 'dosaExtras', name: 'Make it extra', kind: 'many',
    options: [
      { id: 'benne', name: 'Extra benne', price: 25, tone: 'add' },
      { id: 'podi', name: 'Extra podi', price: 15, tone: 'add' },
      { id: 'palya', name: 'Extra stuffing', price: 30, tone: 'add' },
      { id: 'sambar', name: 'Extra sambhar', price: 20, tone: 'add' },
    ],
  },
  idliExtras: {
    id: 'idliExtras', name: 'Make it extra', kind: 'many',
    options: [
      { id: 'sambar', name: 'Extra sambhar', price: 20, tone: 'add' },
      { id: 'ghee', name: 'Extra ghee', price: 15, tone: 'add' },
    ],
  },
  sugar: {
    id: 'sugar', name: 'Sugar', kind: 'one', defaultId: 'regular',
    options: [
      { id: 'regular', name: 'Regular sugar', price: 0 },
      { id: 'less', name: 'Less sugar', price: 0, tone: 'less' },
      { id: 'none', name: 'No sugar', price: 0, tone: 'less' },
    ],
  },
};

export const NOTES: KitchenNote[] = [
  { id: 'less-oil', label: 'Less oil', tone: 'less' },
  { id: 'extra-crisp', label: 'Extra crisp', tone: 'add' },
  { id: 'potato-side', label: 'Potato stuffing on the side', items: ['masala-dosa'] },
];

const dosa = ['dosaExtras'];
const idli = ['idliExtras'];

export const ITEMS: MenuItem[] = [
  // ₹1: GST on it rounds to ₹0, so it charges exactly ₹1: for checking real UPI payments end to end. Test mode only.
  { id: 'test-1', cat: 'test', name: 'Payment test', price: 1, groups: [], notes: false, testOnly: true, placeholder: '₹1',
    desc: 'Only for checking payments. Charges a real ₹1.' },
  { id: 'ghee-podi-benne-dosa', cat: 'dosa', name: 'Ghee Podi Benne Dosa', price: 199, special: true, groups: dosa, notes: true,
    desc: 'Brushed with ghee, rolled in podi, topped with a knob of butter. Bangalore taste, made with love.' },
  { id: 'masala-dosa', cat: 'dosa', name: 'Masala Dosa', price: 209, groups: dosa, notes: true,
    desc: 'Crisp outside, warm spiced potato inside. Just like home.' },
  { id: 'plain-benne-dosa', cat: 'dosa', name: 'Plain Benne Dosa', price: 159, groups: dosa, notes: true,
    desc: 'Soft centre, crisp edges and plenty of butter. The real taste of Bangalore.' },
  { id: 'plain-dosa', cat: 'dosa', name: 'Plain Dosa', price: 169, groups: dosa, notes: true,
    desc: 'Simple, golden and light. With coconut chutney and sambar.' },
  { id: 'mallige-idli', cat: 'idli', name: 'Mallige Idli', price: 89, groups: idli, notes: true,
    desc: "Soft as jasmine, with hot sambar. Have one, you'll want two more." },
  { id: 'thatte-idli', cat: 'idli', name: 'Thatte Idli', price: 89, groups: idli, notes: true,
    desc: 'Big as a plate, soft as a cloud. With two chutneys.' },
  { id: 'ghee-podi-thatte-idli', cat: 'idli', name: 'Ghee Podi Thatte Idli', price: 109, groups: idli, notes: true,
    desc: "Soaked in ghee, coated in podi. It'll make your morning." },
  { id: 'medu-vada', cat: 'idli', name: 'Udupi Medu Vada', price: 89, groups: idli, notes: true,
    desc: 'Crunchy outside, fluffy inside. Proper Udupi style.' },
  { id: 'filter-coffee', cat: 'drinks', name: 'Bengaluru Filter Coffee', price: 69, groups: ['sugar'], notes: false, placeholder: 'Coffee',
    desc: 'Frothy and hot in a steel dabara. A Bangalore morning in your hands.' },
  { id: 'masala-tea', cat: 'drinks', name: 'Masala Tea', price: 49, groups: ['sugar'], notes: false,
    desc: 'Ginger, cardamom and a pinch of clove. Chai that warms you up.' },
];

// Items with a real photo in /public/food. Filter coffee is waiting for the restaurant's own photo.
const PHOTOS = new Set(ITEMS.map((i) => i.id).filter((id) => id !== 'filter-coffee' && id !== 'test-1'));
export const placeholderOf = (id: string) => ITEMS.find((i) => i.id === id)?.placeholder ?? 'Coffee';
// Items the kiosk shows: test-only ones appear only in test mode.
export const visibleItems = (testMode: boolean) => active.items.filter((i) => testMode || !i.testOnly);
export const photoOf = (id: string) => (PHOTOS.has(id) ? `/food/${id}.jpg` : undefined);

// ---- Catalog: the dishes above plus the owner's changes from the dashboard ----
// The dishes, groups and photos live in this file; the owner can change a dish's name, description,
// price and sold-out state, and the price of an extra. Those changes are stored in the database
// (menu_overrides / option_overrides) and merged on top here.
export interface ItemOverride { name?: string | null; desc?: string | null; price?: number | null; soldOut?: boolean }
export interface Overrides { items: Record<string, ItemOverride>; options: Record<string, number> } // options: "group:option" → price
export interface Catalog { items: MenuItem[]; groups: Record<string, ModGroup> }

export const BASE_CATALOG: Catalog = { items: ITEMS, groups: GROUPS };
export const optionKey = (groupId: string, optionId: string) => `${groupId}:${optionId}`;

export function mergeCatalog(o: Overrides): Catalog {
  const items = ITEMS.map((i) => {
    const x = o.items[i.id];
    if (!x) return i;
    return { ...i, name: x.name || i.name, desc: x.desc || i.desc, price: x.price ?? i.price, soldOut: !!x.soldOut };
  });
  const groups: Record<string, ModGroup> = {};
  for (const [gid, g] of Object.entries(GROUPS)) {
    groups[gid] = { ...g, options: g.options.map((op) => ({ ...op, price: o.options[optionKey(gid, op.id)] ?? op.price })) };
  }
  return { items, groups };
}

// The catalog screens read from. The server never changes it (it passes a merged catalog to pricing
// explicitly); the kiosk and board set it after fetching /api/menu.
let active: Catalog = BASE_CATALOG;
export const activeCatalog = () => active;
export const setActiveCatalog = (c: Catalog) => { active = c; };

export const itemById = (id: string, cat: Catalog = active) => cat.items.find((i) => i.id === id);

// Kitchen notes the item sheet offers for an item.
export const notesFor = (item: MenuItem) => (item.notes ? NOTES.filter((n) => !n.items || n.items.includes(item.id)) : []);

// Tone of a choice on an order, looked up by id so orders saved before tones existed still colour correctly.
export const optionTone = (groupId: string, id: string): Tone | undefined => GROUPS[groupId]?.options.find((o) => o.id === id)?.tone;
export const noteTone = (id: string): Tone | undefined => NOTES.find((n) => n.id === id)?.tone;

// Shown as "Goes well with" in the item sheet and "Kuch aur?" in the cart.
export const PAIRING = 'filter-coffee';
export const CART_UPSELL = ['medu-vada', 'mallige-idli', 'masala-tea'];
