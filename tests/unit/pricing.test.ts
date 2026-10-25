import { describe, expect, it } from 'vitest';
import { OrderError, priceLine, priceOrder } from '@/lib/pricing';

const dosa = { itemId: 'ghee-podi-benne-dosa', qty: 1, choices: { spice: ['regular'], dosaExtras: ['benne'] }, notes: ['less-oil', 'extra-sambar'] };
const coffee = { itemId: 'filter-coffee', qty: 2, choices: {}, notes: [] };

describe('pricing', () => {
  it('matches the prototype bill: ₹314 + GST = ₹330, saved ₹48', () => {
    const o = priceOrder([dosa, coffee]);
    expect(o.lines.map((l) => l.lineTotal)).toEqual([196, 118]);
    expect(o).toMatchObject({ itemCount: 3, subtotal: 314, cgst: 7.85, sgst: 7.85, roundOff: 0.3, total: 330, savings: 48 });
  });

  it('rounds down when the paise are under 50', () => {
    const o = priceOrder([{ itemId: 'filter-coffee', qty: 1, choices: {}, notes: [] }]); // 59 + 2×1.48 = 61.96 → 62
    expect(o).toMatchObject({ subtotal: 59, cgst: 1.48, total: 62, roundOff: 0.04 });
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
