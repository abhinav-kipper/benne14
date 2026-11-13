import { describe, expect, it } from 'vitest';
import { GROUPS, ITEMS, notesFor } from '@/lib/menu';
import { GST_RATE, OrderError, priceOrder, type CartLine } from '@/lib/pricing';

// Seeded random carts: the same 2,000 carts every run, so a failure is reproducible.
function rng(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
}
const rand = rng(14);
const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];

function randomCart(): CartLine[] {
  return Array.from({ length: 1 + Math.floor(rand() * 6) }, () => {
    const item = pick(ITEMS);
    const choices: Record<string, string[]> = {};
    for (const gid of item.groups) {
      const g = GROUPS[gid];
      choices[gid] = g.kind === 'one' ? [pick(g.options).id] : g.options.filter(() => rand() < 0.4).map((o) => o.id);
    }
    const notes = notesFor(item).filter(() => rand() < 0.3).map((n) => n.id);
    return { itemId: item.id, qty: 1 + Math.floor(rand() * 20), choices, notes };
  });
}

describe('pricing invariants over 2,000 random carts', () => {
  const carts = Array.from({ length: 2000 }, randomCart);

  it('bills add up exactly, in whole rupees, with GST within 50 paise of 5%', () => {
    for (const cart of carts) {
      const o = priceOrder(cart);
      const lines = o.lines.reduce((a, l) => a + l.lineTotal, 0);
      expect(o.subtotal).toBe(lines);
      expect(Number.isInteger(o.total)).toBe(true);
      expect(o.cgst).toBe(o.sgst);
      expect(Math.round((o.subtotal + o.cgst + o.sgst) * 100)).toBe(o.total * 100); // no hidden round-off
      expect(Math.abs(o.cgst + o.sgst - o.subtotal * GST_RATE)).toBeLessThanOrEqual(0.5);
      expect(o.roundOff).toBe(0);
      expect(o.itemCount).toBe(cart.reduce((a, l) => a + l.qty, 0));
    }
  });

  it('every line is menu price plus paid extras, times quantity', () => {
    for (const cart of carts) {
      for (const l of priceOrder(cart).lines) {
        const item = ITEMS.find((i) => i.id === l.itemId)!;
        expect(l.unitPrice).toBe(item.price + l.mods.reduce((a, m) => a + m.price, 0));
        expect(l.lineTotal).toBe(l.unitPrice * l.qty);
        expect(l.name).toBe(item.name); // name snapshot comes from the menu, not the request
      }
    }
  });

  it('ignores prices or totals sent by the client', () => {
    const honest = priceOrder([{ itemId: 'masala-dosa', qty: 2, choices: {}, notes: [] }]);
    const sneaky = priceOrder([{ itemId: 'masala-dosa', qty: 2, choices: {}, notes: [], price: 1, unitPrice: 1, lineTotal: 1 } as CartLine]);
    expect(sneaky.total).toBe(honest.total);
  });

  it.each([
    ['null line', null],
    ['a string', 'masala-dosa'],
    ['choices as a string', { itemId: 'masala-dosa', qty: 1, choices: 'benne', notes: [] }],
    ['choices as an array', { itemId: 'masala-dosa', qty: 1, choices: ['benne'], notes: [] }],
    ['a choice that is not a list of ids', { itemId: 'masala-dosa', qty: 1, choices: { dosaExtras: [{}] }, notes: [] }],
    ['notes as an object', { itemId: 'masala-dosa', qty: 1, choices: {}, notes: { a: 1 } }],
    ['notes with a number', { itemId: 'masala-dosa', qty: 1, choices: {}, notes: [1] }],
    ['an inherited group name', { itemId: 'masala-dosa', qty: 1, choices: { constructor: ['x'] }, notes: [] }],
    ['an inherited item name', { itemId: 'toString', qty: 1, choices: {}, notes: [] }],
    ['quantity as text', { itemId: 'masala-dosa', qty: '2', choices: {}, notes: [] }],
    ['quantity 21', { itemId: 'masala-dosa', qty: 21, choices: {}, notes: [] }],
    ['negative quantity', { itemId: 'masala-dosa', qty: -1, choices: {}, notes: [] }],
    ['infinite quantity', { itemId: 'masala-dosa', qty: Infinity, choices: {}, notes: [] }],
  ])('rejects %s as a bad order, never a crash', (_, line) => {
    expect(() => priceOrder([line as unknown as CartLine])).toThrow(OrderError);
  });
});
