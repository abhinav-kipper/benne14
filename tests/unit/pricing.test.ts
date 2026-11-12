import { describe, expect, it } from 'vitest';
import { OrderError, priceLine, priceOrder } from '@/lib/pricing';

const dosa = { itemId: 'ghee-podi-benne-dosa', qty: 1, choices: { spice: ['regular'], dosaExtras: ['benne'] }, notes: ['less-oil', 'extra-sambar'] };
const coffee = { itemId: 'filter-coffee', qty: 2, choices: {}, notes: [] };

describe('pricing', () => {
  it('matches the prototype bill: ₹314 + ₹16 GST = ₹330, saved ₹48', () => {
    const o = priceOrder([dosa, coffee]);
    expect(o.lines.map((l) => l.lineTotal)).toEqual([196, 118]);
    // 5% of 314 = 15.70 → GST rounded to ₹16, split 8 + 8: the bill adds up with no round-off line
    expect(o).toMatchObject({ itemCount: 3, subtotal: 314, cgst: 8, sgst: 8, roundOff: 0, total: 330, savings: 48 });
  });

  it('rounds GST to the rupee and can split it into halves', () => {
    const o = priceOrder([{ itemId: 'filter-coffee', qty: 1, choices: {}, notes: [] }]); // 5% of 59 = 2.95 → ₹3
    expect(o).toMatchObject({ subtotal: 59, cgst: 1.5, sgst: 1.5, roundOff: 0, total: 62 });
    expect(o.subtotal + o.cgst + o.sgst).toBe(o.total);
  });

  it('charges exactly ₹1 for the payment test item', () => {
    expect(priceOrder([{ itemId: 'test-1', qty: 1, choices: {}, notes: [] }])).toMatchObject({ subtotal: 1, cgst: 0, sgst: 0, roundOff: 0, total: 1 });
  });

  it('fills in the default for pick-one groups', () => {
    const l = priceLine({ itemId: 'masala-dosa', qty: 1, choices: {}, notes: [] });
    expect(l.mods.map((m) => m.id)).toEqual(['regular']);
    expect(l.unitPrice).toBe(180);
  });

  it('ignores duplicate extras and notes', () => {
    const l = priceLine({ itemId: 'masala-dosa', qty: 1, choices: { dosaExtras: ['benne', 'benne'] }, notes: ['no-onion', 'no-onion'] });
    expect(l.unitPrice).toBe(205);
    expect(l.notes).toHaveLength(1);
  });

  it.each([
    ['unknown item', { itemId: 'pizza', qty: 1, choices: {}, notes: [] }],
    ['zero quantity', { itemId: 'masala-dosa', qty: 0, choices: {}, notes: [] }],
    ['fractional quantity', { itemId: 'masala-dosa', qty: 1.5, choices: {}, notes: [] }],
    ['unknown option', { itemId: 'masala-dosa', qty: 1, choices: { spice: ['volcanic'] }, notes: [] }],
    ['two picks in a pick-one', { itemId: 'masala-dosa', qty: 1, choices: { spice: ['mild', 'fiery'] }, notes: [] }],
    ['group the item does not have', { itemId: 'filter-coffee', qty: 1, choices: { dosaExtras: ['benne'] }, notes: [] }],
    ['kitchen note on a drink', { itemId: 'masala-tea', qty: 1, choices: {}, notes: ['no-onion'] }],
  ])('rejects %s', (_, line) => {
    expect(() => priceOrder([line])).toThrow(OrderError);
  });

  it('rejects an empty cart', () => {
    expect(() => priceOrder([])).toThrow(OrderError);
  });
});
