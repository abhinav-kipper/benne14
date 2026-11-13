import { describe, expect, it } from 'vitest';
import { cleanCode, cleanPhone, describeCode, discountFor, usable, type DiscountCode } from '@/lib/discounts';
import { itemTotal, priceOrder } from '@/lib/pricing';
import { customersCsv, summarize } from '@/lib/reports';
import type { Order } from '@/lib/orders';

const pct = (o: Partial<DiscountCode> = {}): DiscountCode => ({
  code: 'WELCOME10',
  kind: 'percent',
  value: 10,
  minOrder: null,
  maxDiscount: null,
  expiresOn: null,
  active: true,
  ...o,
});
const dosa = [{ itemId: 'masala-dosa', qty: 2, choices: {}, notes: [] }]; // 2 × ₹209 = ₹418

describe('discount codes', () => {
  it('reads a code the way people type it', () => {
    expect(cleanCode(' welcome-10 ')).toBe('WELCOME10');
    for (const bad of ['', 'AB', 'A'.repeat(17), 'SAVE₹50', '<script>', 10, null, undefined])
      expect(cleanCode(bad), String(bad)).toBeNull();
  });

  it('takes a percentage or a flat amount off the item total, within its limits', () => {
    expect(discountFor(418, pct())).toEqual({ amount: 42, short: 0 }); // 41.8 → nearest rupee
    expect(discountFor(418, pct({ maxDiscount: 30 }))).toEqual({ amount: 30, short: 0 });
    expect(discountFor(418, pct({ minOrder: 500 }))).toEqual({ amount: 0, short: 82 });
    expect(discountFor(418, pct({ kind: 'flat', value: 50, minOrder: 300 }))).toEqual({ amount: 50, short: 0 });
    expect(discountFor(49, pct({ kind: 'flat', value: 100 }))).toEqual({ amount: 48, short: 0 }); // ₹1 always remains
  });

  it('charges GST on what is left after the discount', () => {
    const plain = priceOrder(dosa);
    expect(plain).toMatchObject({ subtotal: 418, total: 439, savings: 0, discountCode: null });
    const p = priceOrder(dosa, undefined, pct());
    expect(p).toMatchObject({
      savings: 42,
      discountCode: 'WELCOME10',
      subtotal: 376,
      cgst: 9.5,
      sgst: 9.5,
      total: 395,
    });
    expect(itemTotal(p)).toBe(418);
    expect(p.subtotal + p.cgst + p.sgst).toBe(p.total);
  });

  it('gives nothing, and says how much is missing, under the minimum order', () => {
    const p = priceOrder(dosa, undefined, pct({ minOrder: 500 }));
    expect(p).toMatchObject({ savings: 0, discountCode: null, discountShort: 82, total: 439 });
  });

  it('works only while switched on and not past its last day', () => {
    expect(usable(pct(), '2026-11-13')).toBe(true);
    expect(usable(pct({ active: false }), '2026-11-13')).toBe(false);
    expect(usable(pct({ expiresOn: '2026-11-13' }), '2026-11-13')).toBe(true); // the last day still counts
    expect(usable(pct({ expiresOn: '2026-11-12' }), '2026-11-13')).toBe(false);
  });

  it('describes a code in a line', () => {
    expect(describeCode(pct({ maxDiscount: 50, minOrder: 300 }))).toBe('10% off up to ₹50 on ₹300 or more');
    expect(describeCode(pct({ kind: 'flat', value: 40, minOrder: 200 }))).toBe('₹40 off on ₹200 or more');
  });

  it('shows in reports: takings are after the discount, and the total given is listed', () => {
    const p = priceOrder(dosa, undefined, pct());
    const o = { ...p, status: 'new', payMethod: 'upi', tokenDay: '2026-11-13', createdAt: '2026-11-13T06:00:00Z' };
    const s = summarize([o as unknown as Order], '2026-11-13', '2026-11-13');
    expect(s.takings).toBe(395);
    expect(s.discounts).toEqual({ count: 1, amount: 42 });
    expect(s.gst.taxable).toBe(376);
  });
});

describe('phone numbers', () => {
  it('accepts an Indian mobile number however it is typed', () => {
    for (const ok of ['9876543210', '98765 43210', '+91 98765-43210', '09876543210', '919876543210'])
      expect(cleanPhone(ok), ok).toBe('9876543210');
  });
  it('refuses anything else', () => {
    for (const bad of ['', '12345', '1234567890', '98765432101', 'call me', 9876543210, null])
      expect(cleanPhone(bad), String(bad)).toBeNull();
  });
  it('exports the customer list with country code, safe for a spreadsheet', () => {
    const csv = customersCsv([
      {
        phone: '9876543210',
        name: '=HYPERLINK("x")',
        orders: 2,
        spent: 834,
        firstOrderAt: '2026-11-01T05:00:00Z',
        lastOrderAt: '2026-11-13T05:00:00Z',
      },
    ]);
    expect(csv.split('\r\n')[1]).toBe(`919876543210,"'=HYPERLINK(""x"")",2,834.00,2026-11-01,2026-11-13`);
  });
});
