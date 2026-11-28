// Order pricing. Runs on the server for every order; the kiosk uses the same code only to display totals.
// A discount code comes off the item total before GST, so GST is charged on what is left.
// All maths in whole rupees and whole paise (integers only, no floating point): menu prices, extras
// and discounts are whole rupees. CGST and SGST are each 2.5% of the taxable value, kept to the
// paisa (rounded half-up); only the bill's total is rounded to the rupee, and the difference is
// shown as its own "Round off" line (owner's call, 2026-11-27: the tax itself is not rounded).
// tests/unit/money.test.ts checks this for every total up to ₹2,00,000.
import { discountFor, type DiscountRule } from './discounts';
import { BASE_CATALOG, notesFor, type Catalog } from './menu';

export const GST_PERCENT = 5; // 2.5% CGST + 2.5% SGST, charged on top of menu prices (v1 assumption)
export const GST_RATE = GST_PERCENT / 100;

// One half of the GST (CGST or SGST, 2.5% each) on a whole-rupee taxable value, in whole paise,
// rounded half-up: ₹209 → 522.5 → 523 paise.
export const halfGstPaise = (taxable: number) => Math.floor((taxable * GST_PERCENT * 100 + 100) / 200);
// The bill for a whole-rupee taxable value: both taxes to the paisa, the total to the rupee
// (half a rupee goes up), and what the rounding added or took, in paise.
export function billFor(taxable: number) {
  const half = halfGstPaise(taxable);
  const exact = taxable * 100 + 2 * half; // paise
  const total = Math.floor((exact + 50) / 100); // rupees
  return { halfPaise: half, total, roundOffPaise: total * 100 - exact };
}
const MAX_QTY = 20;

// Packaging on a takeaway order (owner's call, 2026-11-28): a charge per item packed, less for a cup
// of coffee or tea than for a dish. Extras are packed with their dish and add nothing. It is part of
// the taxable value (GST is charged on it, as on the food) and a discount code does not reduce it.
// Dine-in orders have none.
export const PACK_PER_DISH = 15;
export const PACK_PER_DRINK = 5;
const DRINK_SECTIONS = ['drinks'];
// (The ₹1 payment-test item, which exists only in test mode, stays exactly ₹1.)
export const packFor = (cat: string) =>
  cat === 'test' ? 0 : DRINK_SECTIONS.includes(cat) ? PACK_PER_DRINK : PACK_PER_DISH;
// What packaging an order was charged, read from its own lines: each line of a takeaway order
// carries what packing one of it cost, so later changes to the rates never alter a past bill.
export const packagingOf = (lines: { qty: number; pack?: number }[]) =>
  lines.reduce((a, l) => a + (l.pack ?? 0) * l.qty, 0);

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
  pack?: number; // takeaway only: packaging for one of this line, rupees. Not part of lineTotal.
}

export interface PricedOrder {
  lines: PricedLine[];
  itemCount: number;
  subtotal: number; // taxable value: item total minus any discount, plus packaging (takeaway), rupees, 2dp
  cgst: number;
  sgst: number;
  roundOff: number; // what rounding the total to the rupee added (+) or took (−), rupees, 2dp
  total: number; // whole rupees
  savings: number; // the discount taken off the item total, whole rupees (0 without a code)
  discountCode: string | null; // the code that gave it; null when none applied
  discountShort: number; // a code was asked for but the order is this many rupees under its minimum
}

// The item total as the customer reads it: before the discount, packaging and GST.
export const itemTotal = (o: { subtotal: number; savings: number; lines: { qty: number; pack?: number }[] }) =>
  o.subtotal + o.savings - packagingOf(o.lines);

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

// `type`: a takeaway order is charged packaging; dine-in (and a cart whose type is not chosen yet) is not.
export function priceOrder(
  cart: CartLine[],
  cat: Catalog = BASE_CATALOG,
  code?: DiscountRule | null,
  type?: 'dine_in' | 'takeaway' | null,
): PricedOrder {
  if (!cart.length) throw new OrderError('Cart is empty');
  const lines = cart.map((l) => {
    const line = priceLine(l, cat);
    return type === 'takeaway' ? { ...line, pack: packFor(cat.items.find((i) => i.id === line.itemId)!.cat) } : line;
  });
  const gross = lines.reduce((a, l) => a + l.lineTotal, 0);
  const d = code ? discountFor(gross, code) : { amount: 0, short: 0 };
  const taxable = gross - d.amount + packagingOf(lines); // whole rupees
  const bill = billFor(taxable);
  return {
    lines,
    itemCount: lines.reduce((a, l) => a + l.qty, 0),
    subtotal: taxable,
    cgst: bill.halfPaise / 100, // paise worked out as integers; stored and shown in rupees, 2dp
    sgst: bill.halfPaise / 100,
    roundOff: bill.roundOffPaise / 100,
    total: bill.total,
    savings: d.amount,
    discountCode: code && d.amount > 0 ? code.code : null,
    discountShort: d.short,
  };
}

export const inr = (n: number, dp = false) => '₹' + (dp ? n.toFixed(2) : String(Math.round(n)));
