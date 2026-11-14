// Order pricing. Runs on the server for every order; the kiosk uses the same code only to display totals.
// A discount code comes off the item total before GST, so GST is charged on what is left.
// All maths in whole rupees and whole paise (integers only, no floating point): menu prices, extras
// and discounts are whole rupees, GST is rounded half-up to the nearest rupee (allowed under section
// 170 of the CGST Act) and split equally into CGST and SGST, so the bill adds up exactly with no
// round-off line. tests/unit/money.test.ts checks this for every total up to ₹2,00,000.
import { discountFor, type DiscountRule } from './discounts';
import { BASE_CATALOG, notesFor, type Catalog } from './menu';

export const GST_PERCENT = 5; // 2.5% CGST + 2.5% SGST, charged on top of menu prices (v1 assumption)
export const GST_RATE = GST_PERCENT / 100;

// GST on a whole-rupee taxable value, in whole rupees: 5%, rounded half-up.
export const gstOn = (taxable: number) => Math.floor((taxable * GST_PERCENT + 50) / 100);
export const MAX_QTY = 20;

export interface CartLine {
  itemId: string;
  qty: number;
  choices: Record<string, string[]>; // groupId -> option ids
  notes: string[]; // kitchen note ids
}

export interface PricedMod {
  groupId: string;
  id: string;
  name: string;
  price: number;
}

export interface PricedLine {
  itemId: string;
  name: string;
  qty: number;
  unitPrice: number; // item + paid extras, rupees
  lineTotal: number; // rupees
  mods: PricedMod[];
  notes: { id: string; label: string }[];
}

export interface PricedOrder {
  lines: PricedLine[];
  itemCount: number;
  subtotal: number; // taxable value: item total minus any discount, rupees, 2dp
  cgst: number;
  sgst: number;
  roundOff: number; // always 0 now: GST itself is rounded to the rupee (kept for stored orders)
  total: number; // whole rupees
  savings: number; // the discount taken off the item total, whole rupees (0 without a code)
  discountCode: string | null; // the code that gave it; null when none applied
  discountShort: number; // a code was asked for but the order is this many rupees under its minimum
}

// The item total as the customer reads it: before the discount and before GST.
export const itemTotal = (o: { subtotal: number; savings: number }) => o.subtotal + o.savings;

export class OrderError extends Error {}

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

// `cat`: the menu to price from. The server always passes the merged catalog (owner's prices, sold
// out) and screens pass the one they loaded; the default (the menu in code) is for tests.
export function priceLine(line: CartLine, cat: Catalog = BASE_CATALOG): PricedLine {
  const { items, groups: GROUPS } = cat;
  // The cart comes from the network: check its shape before trusting any field.
  if (!line || typeof line !== 'object') throw new OrderError('Bad cart line');
  if (
    line.choices != null &&
    (typeof line.choices !== 'object' || Array.isArray(line.choices) || !Object.values(line.choices).every(isStrings))
  )
    throw new OrderError('Bad choices');
  if (line.notes != null && !isStrings(line.notes)) throw new OrderError('Bad notes');
  const item = items.find((i) => i.id === line.itemId);
  if (!item) throw new OrderError(`Unknown item ${line.itemId}`);
  if (!Number.isInteger(line.qty) || line.qty < 1 || line.qty > MAX_QTY)
    throw new OrderError(`Bad quantity for ${item.name}`);

  const mods: PricedMod[] = [];
  for (const gid of item.groups) {
    const g = GROUPS[gid];
    const picked = line.choices?.[gid] ?? [];
    const ids = g.kind === 'one' ? [picked[0] ?? g.defaultId!] : [...new Set(picked)];
    if (g.kind === 'one' && picked.length > 1) throw new OrderError(`Pick one ${g.name}`);
    for (const id of ids) {
      const o = g.options.find((x) => x.id === id);
      if (!o) throw new OrderError(`Unknown option ${id} for ${item.name}`);
      mods.push({ groupId: gid, id: o.id, name: o.name, price: o.price });
    }
  }
  for (const gid of Object.keys(line.choices ?? {})) {
    if (!Object.hasOwn(GROUPS, gid)) throw new OrderError(`${item.name} has no ${gid}`);
    if (!item.groups.includes(gid)) throw new OrderError(`${item.name} has no ${gid}`);
  }

  const notes = [...new Set(line.notes ?? [])].map((id) => {
    const n = notesFor(item, cat).find((x) => x.id === id);
    if (!n) throw new OrderError(`Note ${id} not allowed for ${item.name}`);
    return { id: n.id, label: n.label };
  });

  const unitPrice = item.price + mods.reduce((a, m) => a + m.price, 0);
  // Money is whole rupees from end to end; a fractional price would break every sum built on it.
  if (!Number.isSafeInteger(unitPrice) || unitPrice < 0) throw new OrderError(`Bad price for ${item.name}`);
  return {
    itemId: item.id,
    name: item.name,
    qty: line.qty,
    unitPrice,
    lineTotal: unitPrice * line.qty,
    mods,
    notes,
  };
}

export function priceOrder(cart: CartLine[], cat: Catalog = BASE_CATALOG, code?: DiscountRule | null): PricedOrder {
  if (!cart.length) throw new OrderError('Cart is empty');
  const lines = cart.map((l) => priceLine(l, cat));
  const gross = lines.reduce((a, l) => a + l.lineTotal, 0);
  const d = code ? discountFor(gross, code) : { amount: 0, short: 0 };
  const taxable = gross - d.amount; // whole rupees
  const gst = gstOn(taxable); // whole rupees
  return {
    lines,
    itemCount: lines.reduce((a, l) => a + l.qty, 0),
    subtotal: taxable,
    cgst: gst / 2, // an odd rupee splits into two exact 50-paise halves
    sgst: gst / 2,
    roundOff: 0,
    total: taxable + gst,
    savings: d.amount,
    discountCode: code && d.amount > 0 ? code.code : null,
    discountShort: d.short,
  };
}

export const inr = (n: number, dp = false) => '₹' + (dp ? n.toFixed(2) : String(Math.round(n)));
