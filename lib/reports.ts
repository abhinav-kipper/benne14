// Owner dashboard numbers, computed from order snapshots (so later price changes never change past
// reports). Pure functions: the API passes in the orders for a range of IST days.
import { addDays, daysBetween, isPaid, istHour, type Order, type PayMethod } from './orders';
import { SHOP } from './shop';

export interface DishRow { itemId: string; name: string; qty: number; amount: number }

export interface Summary {
  takings: number; // paid, not refunded, whole rupees (bills are whole rupees)
  orders: number;
  avgBill: number;
  refunds: { count: number; amount: number };
  split: Record<PayMethod, number>;
  dishes: DishRow[]; // by quantity, then amount
  extras: { qty: number; amount: number };
  hours: { hour: number; orders: number }[]; // shop hours, stretched to any order outside them
  days: { day: string; takings: number; orders: number }[]; // every day in the range, empty ones too
  gst: { taxable: number; cgst: number; sgst: number; total: number };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

// Orders that count: paid (or confirmed at the counter) and not refunded. Cancelled and unpaid UPI
// QRs never count; refunds are reported separately.
export const counts = (o: Order) => isPaid(o) && !o.refundedAt;

export function summarize(all: Order[], fromDay: string, toDay: string): Summary {
  const kept = all.filter(counts);
  const refunded = all.filter((o) => isPaid(o) && o.refundedAt);
  const takings = kept.reduce((a, o) => a + o.total, 0);

  const split: Record<PayMethod, number> = { upi: 0, card: 0, cash: 0 };
  for (const o of kept) split[o.payMethod] += o.total;

  const dishes = new Map<string, DishRow>();
  const extras = { qty: 0, amount: 0 };
  for (const o of kept) for (const l of o.lines) {
    const extra = l.mods.reduce((a, m) => a + m.price, 0);
    const d = dishes.get(l.itemId) ?? { itemId: l.itemId, name: l.name, qty: 0, amount: 0 };
    d.qty += l.qty;
    d.amount += (l.unitPrice - extra) * l.qty;
    dishes.set(l.itemId, d);
    for (const m of l.mods) if (m.price > 0) { extras.qty += l.qty; extras.amount += m.price * l.qty; }
  }

  const byHour = new Map<number, number>();
  for (const o of kept) byHour.set(istHour(o.createdAt), (byHour.get(istHour(o.createdAt)) ?? 0) + 1);
  const seen = [...byHour.keys()];
  const first = Math.min(SHOP.hours.open, ...seen);
  const last = Math.max(SHOP.hours.close - 1, ...seen);
  const hours = Array.from({ length: last - first + 1 }, (_, i) => ({ hour: first + i, orders: byHour.get(first + i) ?? 0 }));

  const n = daysBetween(fromDay, toDay);
  const days = Array.from({ length: Math.max(0, n) }, (_, i) => {
    const day = addDays(fromDay, i);
    const on = kept.filter((o) => o.tokenDay === day);
    return { day, takings: on.reduce((a, o) => a + o.total, 0), orders: on.length };
  });

  return {
    takings,
    orders: kept.length,
    avgBill: kept.length ? Math.round(takings / kept.length) : 0,
    refunds: { count: refunded.length, amount: refunded.reduce((a, o) => a + (o.refundAmount ?? o.total), 0) },
    split,
    dishes: [...dishes.values()].sort((a, b) => b.qty - a.qty || b.amount - a.amount),
    extras,
    hours,
    days,
    gst: {
      taxable: r2(kept.reduce((a, o) => a + o.subtotal, 0)),
      cgst: r2(kept.reduce((a, o) => a + o.cgst, 0)),
      sgst: r2(kept.reduce((a, o) => a + o.sgst, 0)),
      total: takings,
    },
  };
}

// The period just before [from, to], of the same length (yesterday for a day, the 7 days before a week…).
export function previousPeriod(fromDay: string, toDay: string) {
  const n = daysBetween(fromDay, toDay);
  return { from: addDays(fromDay, -n), to: addDays(fromDay, -1) };
}

// ---------- CSV for the CA ----------
const cell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  // Quote when needed, and defuse spreadsheet formulas (a name like "=HYPERLINK(…)" must stay text).
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const csv = (rows: unknown[][]) => rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
const istTime = (iso: string) => new Date(Date.parse(iso) + 5.5 * 3600_000).toISOString().slice(11, 16);

export function billsCsv(all: Order[]) {
  const rows: unknown[][] = [['Date', 'Time', 'Order', 'Type', 'Payment', 'Items', 'Subtotal', 'CGST', 'SGST', 'Total', 'Refunded', 'Refund reason']];
  for (const o of all.filter(isPaid)) {
    rows.push([o.tokenDay, istTime(o.createdAt), o.token, o.type === 'dine_in' ? 'Dine-in' : 'Takeaway', o.payMethod.toUpperCase(),
      o.lines.map((l) => `${l.qty} x ${l.name}`).join('; '), o.subtotal.toFixed(2), o.cgst.toFixed(2), o.sgst.toFixed(2), o.total.toFixed(2),
      o.refundedAt ? (o.refundAmount ?? o.total).toFixed(2) : '', o.refundReason ?? '']);
  }
  return csv(rows);
}

export function gstCsv(all: Order[], fromDay: string, toDay: string) {
  const rows: unknown[][] = [['Date', 'Bills', 'Taxable value', 'CGST 2.5%', 'SGST 2.5%', 'Total']];
  for (const d of summarize(all, fromDay, toDay).days) {
    const s = summarize(all.filter((o) => o.tokenDay === d.day), d.day, d.day);
    rows.push([d.day, s.orders, s.gst.taxable.toFixed(2), s.gst.cgst.toFixed(2), s.gst.sgst.toFixed(2), s.gst.total.toFixed(2)]);
  }
  return csv(rows);
}

export function dishesCsv(all: Order[], fromDay: string, toDay: string) {
  const s = summarize(all, fromDay, toDay);
  return csv([['Dish', 'Sold', 'Amount (before GST)'], ...s.dishes.map((d) => [d.name, d.qty, d.amount.toFixed(2)]), ['Extras', s.extras.qty, s.extras.amount.toFixed(2)]]);
}
