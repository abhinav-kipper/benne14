import { describe, expect, it } from 'vitest';
import { discountFor } from '@/lib/discounts';
import { BASE_CATALOG, mergeCatalog } from '@/lib/menu';
import { counts, NEXT, PAID, type Order } from '@/lib/orders';
import { gstOn, GST_PERCENT, OrderError, priceOrder, type CartLine } from '@/lib/pricing';
import { billsCsv, dishesCsv, gstCsv, summarize } from '@/lib/reports';

// The money rules, checked exhaustively or over seeded random data rather than by a few examples.
// An independent calculation in BigInt (no floating point anywhere) is the reference.
const gstRef = (taxable: number) => Number((BigInt(taxable) * BigInt(GST_PERCENT) + 50n) / 100n);

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

describe('GST', () => {
  it('is 5% rounded half-up to the rupee, for every taxable value from ₹0 to ₹2,00,000', () => {
    for (let t = 0; t <= 200_000; t++) {
      const g = gstOn(t);
      if (g !== gstRef(t)) throw new Error(`GST on ₹${t}: got ${g}, want ${gstRef(t)}`);
      if (Math.abs(g * 100 - t * GST_PERCENT) > 50) throw new Error(`GST on ₹${t} is more than 50 paise off`);
    }
  });

  it('rounds the half rupee up, and splits evenly into CGST and SGST', () => {
    expect([9, 10, 29, 30, 49, 50].map(gstOn)).toEqual([0, 1, 1, 2, 2, 3]); // ₹10 → 50 paise → ₹1
    const o = priceOrder([{ itemId: 'masala-tea', qty: 1, choices: {}, notes: [] }]); // ₹49 → GST ₹2 (2.45)
    expect([o.cgst, o.sgst, o.total]).toEqual([1, 1, 51]);
    const p = priceOrder([{ itemId: 'mallige-idli', qty: 3, choices: {}, notes: [] }]); // ₹267 → 13.35 → ₹13
    expect([p.cgst, p.sgst, p.total]).toEqual([6.5, 6.5, 280]);
    expect(p.cgst * 100).toBe(650); // a half rupee is exact in paise
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

  it('every discounted bill still adds up: item total − discount + GST on the rest = total', () => {
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
      expect(o.cgst + o.sgst).toBe(gstOn(o.subtotal));
      expect(o.total).toBe(o.subtotal + gstOn(o.subtotal));
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
    expect(sum([s.gst.taxable, s.gst.cgst, s.gst.sgst])).toBe(s.gst.total);
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
    const bills = rows(billsCsv(orders)); // …, Discount, Code, Taxable value, CGST, SGST, Total, Refunded, Reason
    const live = bills.filter((r) => r[12] === '');
    expect(live.length).toBe(s.orders);
    expect(sum(live.map((r) => +r[11]))).toBe(s.takings);
    expect(sum(live.map((r) => +r[8]))).toBe(s.gst.taxable);
    expect(sum(live.map((r) => +r[6] || 0))).toBe(s.discounts.amount);
    expect(sum(bills.filter((r) => r[12] !== '').map((r) => +r[12]))).toBe(s.refunds.amount);
    for (const r of bills) expect(sum([+r[8], +r[9], +r[10]])).toBe(+r[11]); // every bill adds up on its own

    const gst = rows(gstCsv(orders, from, to)); // Date, Bills, Taxable, CGST, SGST, Total
    expect(gst.length).toBe(3);
    expect(sum(gst.map((r) => +r[1]))).toBe(s.orders);
    expect(sum(gst.map((r) => +r[2]))).toBe(s.gst.taxable);
    expect(sum(gst.map((r) => +r[3]))).toBe(s.gst.cgst);
    expect(sum(gst.map((r) => +r[5]))).toBe(s.takings);

    const dishes = rows(dishesCsv(orders, from, to)); // Dish, Sold, Amount: dishes, then Extras, then Discount codes (minus)
    expect(sum(dishes.map((r) => +r[2]))).toBe(s.gst.taxable);
  });
});
