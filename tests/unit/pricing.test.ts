import { describe, expect, it } from 'vitest';
import { OrderError, priceLine, priceOrder } from '@/lib/pricing';

const dosa = { itemId: 'ghee-podi-benne-dosa', qty: 1, choices: { dosaExtras: ['benne'] }, notes: ['less-oil', 'extra-crisp'] };
const coffee = { itemId: 'filter-coffee', qty: 2, choices: {}, notes: [] };

describe('pricing', () => {
  it('bills full menu prices, no discount: ₹362 + ₹18 GST = ₹380', () => {
    const o = priceOrder([dosa, coffee]);
    expect(o.lines.map((l) => l.lineTotal)).toEqual([224, 138]); // 199 + 25 extra benne; 2 × 69
    // 5% of 362 = 18.10 → GST rounded to ₹18, split 9 + 9: the bill adds up with no round-off line
    expect(o).toMatchObject({ itemCount: 3, subtotal: 362, cgst: 9, sgst: 9, roundOff: 0, total: 380, savings: 0 });
  });

  it('rounds GST to the rupee and can split it into halves', () => {
    const o = priceOrder([{ itemId: 'masala-tea', qty: 1, choices: {}, notes: [] }]); // 5% of 49 = 2.45 → ₹2
    expect(o).toMatchObject({ subtotal: 49, cgst: 1, sgst: 1, roundOff: 0, total: 51 });
    const p = priceOrder([{ itemId: 'mallige-idli', qty: 1, choices: {}, notes: [] }]); // 5% of 89 = 4.45 → ₹4
    expect(p).toMatchObject({ subtotal: 89, cgst: 2, sgst: 2, total: 93 });
    const q = priceOrder([{ itemId: 'plain-benne-dosa', qty: 1, choices: {}, notes: [] }]); // 5% of 159 = 7.95 → ₹8
    expect(q).toMatchObject({ cgst: 4, sgst: 4, total: 167 });
    const r = priceOrder([{ itemId: 'medu-vada', qty: 3, choices: {}, notes: [] }]); // 5% of 267 = 13.35 → ₹13
    expect(r).toMatchObject({ cgst: 6.5, sgst: 6.5, total: 280 });
    expect(o.subtotal + o.cgst + o.sgst).toBe(o.total);
  });

  it('charges exactly ₹1 for the payment test item', () => {
    expect(priceOrder([{ itemId: 'test-1', qty: 1, choices: {}, notes: [] }])).toMatchObject({ subtotal: 1, cgst: 0, sgst: 0, roundOff: 0, total: 1 });
  });

  it('fills in the default for pick-one groups', () => {
    const l = priceLine({ itemId: 'filter-coffee', qty: 1, choices: {}, notes: [] });
    expect(l.mods.map((m) => m.id)).toEqual(['regular']);
    expect(l.unitPrice).toBe(69);
  });

  it('ignores duplicate extras and notes', () => {
    const l = priceLine({ itemId: 'masala-dosa', qty: 1, choices: { dosaExtras: ['benne', 'benne'] }, notes: ['less-oil', 'less-oil'] });
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
    ['potato on the side for a dosa without potato', { itemId: 'plain-dosa', qty: 1, choices: {}, notes: ['potato-side'] }],
    ['group the item does not have', { itemId: 'filter-coffee', qty: 1, choices: { dosaExtras: ['benne'] }, notes: [] }],
    ['kitchen note on a drink', { itemId: 'masala-tea', qty: 1, choices: {}, notes: ['no-onion'] }],
  ])('rejects %s', (_, line) => {
    expect(() => priceOrder([line])).toThrow(OrderError);
  });

  it('offers potato stuffing on the side for masala dosa', () => {
    expect(priceLine({ itemId: 'masala-dosa', qty: 1, choices: {}, notes: ['potato-side'] }).notes[0].label).toBe('Potato stuffing on the side');
  });

  it('rejects an empty cart', () => {
    expect(() => priceOrder([])).toThrow(OrderError);
  });
});
