// Order pricing. Runs on the server for every order; the kiosk uses the same code only to display totals.
// All maths in paise (integers) so GST and round-off never drift.
import { GROUPS, ITEMS, NOTES, type MenuItem } from './menu';

export const GST_RATE = 0.05; // 2.5% CGST + 2.5% SGST, charged on top of menu prices (v1 assumption)
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
  hi?: string;
  price: number;
}

export interface PricedLine {
  itemId: string;
  name: string;
  hi: string;
  qty: number;
  unitPrice: number; // item + paid extras, rupees
  lineTotal: number; // rupees
  mrpTotal: number; // what it would cost without the launch offer
  mods: PricedMod[];
  notes: { id: string; label: string; hi: string }[];
}

export interface PricedOrder {
  lines: PricedLine[];
  itemCount: number;
  subtotal: number; // rupees, 2dp
  cgst: number;
  sgst: number;
  roundOff: number;
  total: number; // whole rupees
  savings: number;
}

export class OrderError extends Error {}

const paise = (r: number) => Math.round(r * 100);
const rupees = (p: number) => p / 100;

export function priceLine(line: CartLine, items: MenuItem[] = ITEMS): PricedLine {
  const item = items.find((i) => i.id === line.itemId);
  if (!item) throw new OrderError(`Unknown item ${line.itemId}`);
  if (!Number.isInteger(line.qty) || line.qty < 1 || line.qty > MAX_QTY) throw new OrderError(`Bad quantity for ${item.name}`);

  const mods: PricedMod[] = [];
  for (const gid of item.groups) {
    const g = GROUPS[gid];
    const picked = line.choices?.[gid] ?? [];
    const ids = g.kind === 'one' ? [picked[0] ?? g.defaultId!] : [...new Set(picked)];
    if (g.kind === 'one' && picked.length > 1) throw new OrderError(`Pick one ${g.name}`);
    for (const id of ids) {
      const o = g.options.find((x) => x.id === id);
      if (!o) throw new OrderError(`Unknown option ${id} for ${item.name}`);
      mods.push({ groupId: gid, id: o.id, name: o.name, hi: o.hi, price: o.price });
    }
  }
  for (const gid of Object.keys(line.choices ?? {})) {
    if (!item.groups.includes(gid)) throw new OrderError(`${item.name} has no ${gid}`);
  }

  const notes = [...new Set(line.notes ?? [])].map((id) => {
    const n = NOTES.find((x) => x.id === id);
    if (!n || !item.notes) throw new OrderError(`Note ${id} not allowed for ${item.name}`);
    return { id: n.id, label: n.label, hi: n.hi };
  });

  const unitPrice = item.price + mods.reduce((a, m) => a + m.price, 0);
  return {
    itemId: item.id, name: item.name, hi: item.hi, qty: line.qty,
    unitPrice, lineTotal: unitPrice * line.qty,
    mrpTotal: (item.mrp + mods.reduce((a, m) => a + m.price, 0)) * line.qty,
    mods, notes,
  };
}

export function priceOrder(cart: CartLine[], items: MenuItem[] = ITEMS): PricedOrder {
  if (!cart.length) throw new OrderError('Cart is empty');
  const lines = cart.map((l) => priceLine(l, items));
  const sub = paise(lines.reduce((a, l) => a + l.lineTotal, 0));
  const half = Math.round(sub * (GST_RATE / 2));
  const exact = sub + 2 * half;
  const total = Math.round(exact / 100) * 100;
  return {
    lines,
    itemCount: lines.reduce((a, l) => a + l.qty, 0),
    subtotal: rupees(sub),
    cgst: rupees(half),
    sgst: rupees(half),
    roundOff: rupees(total - exact),
    total: rupees(total),
    savings: lines.reduce((a, l) => a + (l.mrpTotal - l.lineTotal), 0),
  };
}

export const inr = (n: number, dp = false) => '₹' + (dp ? n.toFixed(2) : String(Math.round(n)));
