import { describe, expect, it } from 'vitest';
import type { DiscountRule } from '@/lib/discounts';
import { itemTotal, OrderError, packagingOf, priceLine, priceOrder } from '@/lib/pricing';

const dosa = {
  itemId: 'ghee-podi-benne-dosa',
  qty: 1,
  choices: { dosaExtras: ['benne'] },
  notes: [],
};
const coffee = { itemId: 'filter-coffee', qty: 2, choices: {}, notes: [] };

describe('pricing', () => {
  it('bills full menu prices, no discount: ₹362 + ₹18.10 GST, rounded to ₹380', () => {
    const o = priceOrder([dosa, coffee]);
    expect(o.lines.map((l) => l.lineTotal)).toEqual([224, 138]); // 199 + 25 extra benne; 2 × 69
    // 2.5% of 362 = 9.05 twice; 380.10 is rounded to ₹380 and the 10 paise shows as the round off
    expect(o).toMatchObject({
      itemCount: 3,
      subtotal: 362,
      cgst: 9.05,
      sgst: 9.05,
      roundOff: -0.1,
      total: 380,
      savings: 0,
    });
  });

  it('takeaway adds packaging: ₹15 a dish, ₹5 a coffee or tea, GST on top; dine-in adds none', () => {
    const out = priceOrder([dosa, coffee], undefined, null, 'takeaway');
    expect(out.lines.map((l) => l.pack)).toEqual([15, 5]); // per one of each line
    expect(out.lines.map((l) => l.lineTotal)).toEqual([224, 138]); // the dishes cost what they cost
    expect(packagingOf(out.lines)).toBe(15 + 2 * 5); // one dosa (its extra packs with it), two coffees
    expect(itemTotal(out)).toBe(362);
    // taxable 362 + 25 = 387; 2.5% of it is 9.675 → 9.68 each; 406.36 → ₹406
    expect(out).toMatchObject({ subtotal: 387, cgst: 9.68, sgst: 9.68, roundOff: -0.36, total: 406 });
    expect(out.total).toBe(out.subtotal + out.cgst + out.sgst + out.roundOff);

    for (const type of ['dine_in', null, undefined] as const) {
      const o = priceOrder([dosa, coffee], undefined, null, type);
      expect(o.total).toBe(380);
      expect(packagingOf(o.lines)).toBe(0);
      expect(o.lines.every((l) => l.pack === undefined)).toBe(true);
    }
    // an order from before packaging existed has no `pack` on its lines: it reads as none
    expect(packagingOf([{ qty: 3 }])).toBe(0);
  });

  it('a discount code comes off the dishes, not off the packaging', () => {
    const code: DiscountRule = { code: 'TEN', kind: 'percent', value: 10, minOrder: null, maxDiscount: null };
    const o = priceOrder([dosa, coffee], undefined, code, 'takeaway');
    expect(o.savings).toBe(36); // 10% of 362, not of 387
    expect(o.subtotal).toBe(362 - 36 + 25);
    expect(itemTotal(o)).toBe(362);
  });

  it('keeps each tax to the paisa and rounds only the total', () => {
    const adds = (x: ReturnType<typeof priceOrder>) =>
      Math.round((x.subtotal + x.cgst + x.sgst + x.roundOff) * 100) === x.total * 100;
    const o = priceOrder([{ itemId: 'masala-tea', qty: 1, choices: {}, notes: [] }]); // 2.5% of 49 = 1.225 → 1.23
    expect(o).toMatchObject({ subtotal: 49, cgst: 1.23, sgst: 1.23, roundOff: -0.46, total: 51 });
    const p = priceOrder([{ itemId: 'mallige-idli', qty: 1, choices: {}, notes: [] }]); // 2.5% of 89 = 2.225 → 2.23
    expect(p).toMatchObject({ subtotal: 89, cgst: 2.23, sgst: 2.23, roundOff: -0.46, total: 93 });
    const q = priceOrder([{ itemId: 'plain-benne-dosa', qty: 1, choices: {}, notes: [] }]); // 159: 3.975 → 3.98
    expect(q).toMatchObject({ cgst: 3.98, sgst: 3.98, roundOff: 0.04, total: 167 });
    const r = priceOrder([{ itemId: 'medu-vada', qty: 3, choices: {}, notes: [] }]); // 267: 6.675 → 6.68
    expect(r).toMatchObject({ cgst: 6.68, sgst: 6.68, roundOff: -0.36, total: 280 });
    for (const x of [o, p, q, r]) expect(adds(x)).toBe(true);
  });

  it('charges exactly ₹1 for the payment test item', () => {
    expect(priceOrder([{ itemId: 'test-1', qty: 1, choices: {}, notes: [] }])).toMatchObject({
      subtotal: 1,
      cgst: 0.03, // 2.5 paise, half a paisa going up
      sgst: 0.03,
      roundOff: -0.06,
      total: 1,
    });
  });

  it('fills in the default for pick-one groups', () => {
    const l = priceLine({ itemId: 'filter-coffee', qty: 1, choices: {}, notes: [] });
    expect(l.mods.map((m) => m.id)).toEqual(['regular']);
    expect(l.unitPrice).toBe(69);
  });

  it('ignores duplicate extras and notes', () => {
    const l = priceLine({
      itemId: 'masala-dosa',
      qty: 1,
      choices: { dosaExtras: ['benne', 'benne'] },
      notes: ['potato-side', 'potato-side'],
    });
    expect(l.unitPrice).toBe(234);
    expect(l.notes).toHaveLength(1);
  });

  it.each([
    ['unknown item', { itemId: 'pizza', qty: 1, choices: {}, notes: [] }],
    ['zero quantity', { itemId: 'masala-dosa', qty: 0, choices: {}, notes: [] }],
    ['fractional quantity', { itemId: 'masala-dosa', qty: 1.5, choices: {}, notes: [] }],
    ['unknown option', { itemId: 'filter-coffee', qty: 1, choices: { sugar: ['volcanic'] }, notes: [] }],
    ['two picks in a pick-one', { itemId: 'filter-coffee', qty: 1, choices: { sugar: ['less', 'none'] }, notes: [] }],
    ['podi spice (removed)', { itemId: 'masala-dosa', qty: 1, choices: { spice: ['mild'] }, notes: [] }],
    ['a removed note', { itemId: 'masala-dosa', qty: 1, choices: {}, notes: ['no-onion'] }],
    ['less oil (no longer offered)', { itemId: 'masala-dosa', qty: 1, choices: {}, notes: ['less-oil'] }],
    ['extra crisp (no longer offered)', { itemId: 'plain-dosa', qty: 1, choices: {}, notes: ['extra-crisp'] }],
    [
      'potato on the side for a dosa without potato',
      { itemId: 'plain-dosa', qty: 1, choices: {}, notes: ['potato-side'] },
    ],
    [
      'group the item does not have',
      { itemId: 'filter-coffee', qty: 1, choices: { dosaExtras: ['benne'] }, notes: [] },
    ],
    ['kitchen note on a drink', { itemId: 'masala-tea', qty: 1, choices: {}, notes: ['no-onion'] }],
  ])('rejects %s', (_, line) => {
    expect(() => priceOrder([line])).toThrow(OrderError);
  });

  it('offers potato stuffing on the side for masala dosa', () => {
    expect(priceLine({ itemId: 'masala-dosa', qty: 1, choices: {}, notes: ['potato-side'] }).notes[0].label).toBe(
      'Potato stuffing on the side',
    );
  });

  it('rejects an empty cart', () => {
    expect(() => priceOrder([])).toThrow(OrderError);
  });
});
