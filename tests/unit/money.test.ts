import { describe, expect, it } from 'vitest';
import { discountFor } from '@/lib/discounts';
import { BASE_CATALOG, mergeCatalog } from '@/lib/menu';
import { counts, NEXT, PAID, type Order } from '@/lib/orders';
import { billFor, GST_PERCENT, halfGstPaise, OrderError, priceOrder, type CartLine } from '@/lib/pricing';
import { billsCsv, dishesCsv, gstCsv, summarize } from '@/lib/reports';

// The money rules, checked exhaustively or over seeded random data rather than by a few examples.
// An independent calculation in BigInt (no floating point anywhere) is the reference.
// One half of the GST (2.5%), in paise, half a paisa going up.
const halfRef = (taxable: number) => Number((BigInt(taxable) * BigInt(GST_PERCENT) * 100n + 100n) / 200n);
// The total as it was billed before 2026-11-27, when GST itself was rounded to the rupee.
const oldTotal = (taxable: number) => taxable + Number((BigInt(taxable) * BigInt(GST_PERCENT) + 50n) / 100n);

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

describe('GST', () => {
  it('each tax is 2.5% to the paisa and only the total is rounded, for every taxable value from ₹0 to ₹2,00,000', () => {
    for (let t = 0; t <= 200_000; t++) {
      const b = billFor(t);
      if (halfGstPaise(t) !== halfRef(t)) throw new Error(`half GST on ₹${t}: got ${halfGstPaise(t)}`);
      const exact = t * 100 + 2 * halfRef(t); // paise
      if (b.total * 100 - exact !== b.roundOffPaise) throw new Error(`₹${t}: the bill does not add up`);
      if (Math.abs(b.roundOffPaise) > 50) throw new Error(`₹${t}: rounded by more than 50 paise`);
      if (Math.abs(2 * b.halfPaise - t * GST_PERCENT) > 1) throw new Error(`₹${t}: GST is more than a paisa off 5%`);
      // what the customer pays did not change when the tax stopped being rounded
      if (b.total !== oldTotal(t)) throw new Error(`₹${t}: total ${b.total} differs from the old ${oldTotal(t)}`);
    }
  });

  it('shows the tax to the paisa, rounds the total, and says what the rounding was', () => {
    const o = priceOrder([{ itemId: 'masala-tea', qty: 1, choices: {}, notes: [] }]); // ₹49: 2.5% = 1.225 → 1.23
    expect([o.cgst, o.sgst, o.roundOff, o.total]).toEqual([1.23, 1.23, -0.46, 51]);
    const p = priceOrder([{ itemId: 'mallige-idli', qty: 3, choices: {}, notes: [] }]); // ₹267: 6.675 → 6.68
    expect([p.cgst, p.sgst, p.roundOff, p.total]).toEqual([6.68, 6.68, -0.36, 280]);
    const q = priceOrder([{ itemId: 'filter-coffee', qty: 10, choices: {}, notes: [] }]); // ₹690: 17.25 each
    expect([q.cgst, q.sgst, q.roundOff, q.total]).toEqual([17.25, 17.25, 0.5, 725]); // 724.50: the half rupee goes up
    const r = priceOrder([{ itemId: 'masala-dosa', qty: 20, choices: {}, notes: [] }]); // ₹4180: 104.50 each
    expect([r.cgst, r.sgst, r.roundOff, r.total]).toEqual([104.5, 104.5, 0, 4389]); // already a whole rupee
  });
});

describe('discounts', () => {
  it('a percentage is rounded half-up to the rupee and never takes the whole bill, for every total and percent', () => {
    for (let t = 1; t <= 3000; t++)
      for (let v = 1; v <= 90; v++) {
        const got = discountFor(t, { code: 'X', kind: 'percent', value: v, minOrder: null, maxDiscount: null }).amount;
        const want = Math.min(Number((BigInt(t) * BigInt(v) + 50n) / 100n), t - 1);
        if (got !== want) throw new Error(`${v}% of ₹${t}: got ${got}, want ${want}`);
      }
  });

  it('every discounted bill still adds up: item total − discount + GST on the rest + round off = total', () => {
    const rand = rng(7);
    for (let i = 0; i < 3000; i++) {
      const cart: CartLine[] = [
        { itemId: 'masala-dosa', qty: 1 + Math.floor(rand() * 20), choices: {}, notes: [] },
        { itemId: 'masala-tea', qty: 1 + Math.floor(rand() * 20), choices: {}, notes: [] },
      ];
      const flat = rand() < 0.5;
      const o = priceOrder(cart, undefined, {
        code: 'C',
        kind: flat ? 'flat' : 'percent',
        value: flat ? 1 + Math.floor(rand() * 500) : 1 + Math.floor(rand() * 90),
        minOrder: rand() < 0.3 ? Math.floor(rand() * 3000) : null,
        maxDiscount: rand() < 0.3 ? 1 + Math.floor(rand() * 200) : null,
      });
      const gross = o.lines.reduce((a, l) => a + l.lineTotal, 0);
      expect(o.subtotal).toBe(gross - o.savings);
      expect(o.subtotal).toBeGreaterThanOrEqual(1);
      const b = billFor(o.subtotal);
      expect(Math.round(o.cgst * 100)).toBe(b.halfPaise);
      expect(o.cgst).toBe(o.sgst);
      expect(Math.round((o.subtotal + o.cgst + o.sgst + o.roundOff) * 100)).toBe(o.total * 100);
      expect(o.total).toBe(oldTotal(o.subtotal));
      expect(Number.isInteger(o.total) && Number.isInteger(o.subtotal) && Number.isInteger(o.savings)).toBe(true);
      expect(!!o.discountCode).toBe(o.savings > 0); // a discount always names its code, and only then
    }
  });
});

describe('prices', () => {
  it('refuses a menu with a fractional or negative price instead of billing it', () => {
    const half = mergeCatalog({ items: { 'masala-tea': { price: 49.5 } }, options: {} });
    expect(() => priceOrder([{ itemId: 'masala-tea', qty: 1, choices: {}, notes: [] }], half)).toThrow(OrderError);
    const minus = mergeCatalog({ items: {}, options: { 'dosaExtras:benne': -500 } });
    expect(() =>
      priceOrder([{ itemId: 'masala-dosa', qty: 1, choices: { dosaExtras: ['benne'] }, notes: [] }], minus),
    ).toThrow(OrderError);
  });
});

describe('what counts as takings', () => {
  it('is one rule: paid and not refunded', () => {
    const o = (status: Order['status'], refundedAt: string | null = null) => ({ status, refundedAt });
    expect(PAID.map((s) => counts(o(s)))).toEqual([true, true, true, true]);
    expect((['pending_payment', 'awaiting_cash', 'cancelled'] as const).map((s) => counts(o(s)))).toEqual([
      false,
      false,
      false,
    ]);
    expect(counts(o('handed_over', '2026-11-13T05:00:00Z'))).toBe(false);
  });

  it('a paid order can never be cancelled, only refunded', () => {
    for (const s of PAID) expect(NEXT[s], s).not.toContain('cancelled');
  });
});

// Random days of orders in every state: the dashboard, and each CSV the accountant gets, must agree.
describe('reports agree with each other over random days', () => {
  const rand = rng(2026);
  const pick = <T>(a: readonly T[]) => a[Math.floor(rand() * a.length)];
  const items = BASE_CATALOG.items.filter((i) => !i.testOnly);
  const days = ['2026-11-10', '2026-11-11', '2026-11-12'];
  const orders: Order[] = Array.from({ length: 600 }, (_, n) => {
    const cart: CartLine[] = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => {
      const item = pick(items);
      const choices: Record<string, string[]> = {};
      for (const g of item.groups) {
        const grp = BASE_CATALOG.groups[g];
        choices[g] =
          grp.kind === 'one' ? [pick(grp.options).id] : grp.options.filter(() => rand() < 0.3).map((x) => x.id);
      }
      return { itemId: item.id, qty: 1 + Math.floor(rand() * 4), choices, notes: [] };
    });
    const code =
      rand() < 0.25
        ? { code: 'TEN', kind: 'percent' as const, value: 10, minOrder: null, maxDiscount: rand() < 0.5 ? 30 : null }
        : null;
    const priced = priceOrder(cart, undefined, code);
    const status = pick([
      'handed_over',
      'handed_over',
      'ready',
      'cooking',
      'new',
      'cancelled',
      'pending_payment',
      'awaiting_cash',
    ] as const);
    const day = pick(days);
    const paid = PAID.includes(status);
    const refunded = paid && rand() < 0.1;
    return {
      ...priced,
      id: `o-${n}`,
      token: String(n + 1),
      tokenDay: day,
      type: pick(['dine_in', 'takeaway'] as const),
      customerName: null,
      payMethod: pick(['upi', 'card', 'cash'] as const),
      status,
      createdAt: `${day}T0${Math.floor(rand() * 9)}:30:00Z`,
      updatedAt: `${day}T09:00:00Z`,
      paidAt: paid ? `${day}T09:00:00Z` : null,
      readyAt: null,
      refundedAt: refunded ? `${day}T10:00:00Z` : null,
      refundReason: refunded ? 'Wrong order' : null,
      refundAmount: refunded ? priced.total : null,
    };
  });
  const [from, to] = [days[0], days[2]];
  const s = summarize(orders, from, to);
  const kept = orders.filter(counts);
  // none of these cells holds a comma (no customer names, plain refund reasons), so a plain split is exact
  const rows = (csv: string) =>
    csv
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n')
      .slice(1)
      .map((r) => r.split(','));
  const sum = (xs: number[]) => Math.round(xs.reduce((a, x) => a + x, 0) * 100) / 100;

  it('takings are exactly the paid, unrefunded bills', () => {
    expect(kept.length).toBeGreaterThan(100);
    expect(s.orders).toBe(kept.length);
    expect(s.takings).toBe(sum(kept.map((o) => o.total)));
    expect(s.split.upi + s.split.card + s.split.cash).toBe(s.takings);
    expect(sum(s.days.map((d) => d.takings))).toBe(s.takings);
    expect(sum(s.days.map((d) => d.orders))).toBe(s.orders);
    expect(sum(s.hours.map((h) => h.orders))).toBe(s.orders);
  });

  it('GST adds up, and matches what was sold', () => {
    expect(sum([s.gst.taxable, s.gst.cgst, s.gst.sgst, s.gst.roundOff])).toBe(s.gst.total);
    expect(s.gst.total).toBe(s.takings);
    expect(s.gst.cgst).toBe(s.gst.sgst);
    // dishes + extras − discounts is the taxable value: nothing sold is missing from the dish report
    expect(sum(s.dishes.map((d) => d.amount)) + s.extras.amount - s.discounts.amount).toBe(s.gst.taxable);
    expect(sum(s.dishes.map((d) => d.qty))).toBe(sum(kept.map((o) => o.itemCount)));
  });

  it('refunds are listed once and never counted as takings', () => {
    const refunded = orders.filter((o) => o.refundedAt);
    expect(s.refunds).toEqual({ count: refunded.length, amount: sum(refunded.map((o) => o.total)) });
    expect(kept.some((o) => o.refundedAt)).toBe(false);
  });

  it('the bills CSV, the GST-by-day CSV and the dish CSV all give the dashboard’s numbers', () => {
    const bills = rows(billsCsv(orders)); // Date, Time, Invoice, Order, …, Discount, Code, Taxable value, CGST, SGST, Round off, Total, Refunded, Reason
    const live = bills.filter((r) => r[14] === '');
    expect(live.length).toBe(s.orders);
    expect(sum(live.map((r) => +r[13]))).toBe(s.takings);
    expect(sum(live.map((r) => +r[9]))).toBe(s.gst.taxable);
    expect(sum(live.map((r) => +r[7] || 0))).toBe(s.discounts.amount);
    expect(sum(bills.filter((r) => r[14] !== '').map((r) => +r[14]))).toBe(s.refunds.amount);
    for (const r of bills) expect(sum([+r[9], +r[10], +r[11], +r[12]])).toBe(+r[13]); // every bill adds up on its own

    const gst = rows(gstCsv(orders, from, to)); // Date, Bills, Taxable, CGST, SGST, Round off, Total
    expect(gst.length).toBe(3);
    expect(sum(gst.map((r) => +r[1]))).toBe(s.orders);
    expect(sum(gst.map((r) => +r[2]))).toBe(s.gst.taxable);
    expect(sum(gst.map((r) => +r[3]))).toBe(s.gst.cgst);
    expect(sum(gst.map((r) => +r[5]))).toBe(s.gst.roundOff);
    expect(sum(gst.map((r) => +r[6]))).toBe(s.takings);

    const dishes = rows(dishesCsv(orders, from, to)); // Dish, Sold, Amount: dishes, then Extras, then Discount codes (minus)
    expect(sum(dishes.map((r) => +r[2]))).toBe(s.gst.taxable);
  });
});
