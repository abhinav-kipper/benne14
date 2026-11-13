import { describe, expect, it } from 'vitest';
import { BASE_CATALOG, mergeCatalog } from '@/lib/menu';
import { bestSellers, suggestFor } from '@/lib/suggest';

const ids = (cart: string[], popular: string[] = [], cat = BASE_CATALOG) =>
  suggestFor(cart, cat, popular).map((i) => i.id);
const catOf = (id: string) => BASE_CATALOG.items.find((i) => i.id === id)!.cat;

describe('cart suggestions ("Anything else?")', () => {
  it('offers what the order is missing: a dosa order gets a drink and a side first', () => {
    const s = ids(['masala-dosa']);
    expect(s).toHaveLength(3);
    expect(s.map(catOf)).toEqual(['drinks', 'idli', 'drinks']);
    expect(s).not.toContain('masala-dosa');
  });

  it('changes with the order', () => {
    expect(ids(['filter-coffee']).map(catOf)).toEqual(['idli', 'dosa', 'idli']); // only a drink: food first
    expect(ids(['masala-dosa', 'filter-coffee']).map(catOf)[0]).toBe('idli'); // has dosa and drink: a side
    expect(ids(['masala-dosa'])).not.toEqual(ids(['filter-coffee']));
  });

  it('puts the best sellers first within a section', () => {
    expect(ids(['masala-dosa'], ['masala-tea', 'medu-vada'])).toEqual(['masala-tea', 'medu-vada', 'filter-coffee']);
    expect(ids(['masala-dosa'], ['filter-coffee'])[0]).toBe('filter-coffee');
  });

  it('never offers a dish that is in the order, sold out, or only for testing', () => {
    const cat = mergeCatalog({
      items: { 'filter-coffee': { soldOut: true }, 'masala-tea': { soldOut: true } },
      options: {},
    });
    const s = ids(['masala-dosa', 'medu-vada'], [], cat);
    expect(s).not.toContain('filter-coffee');
    expect(s).not.toContain('masala-tea');
    expect(s).not.toContain('medu-vada');
    expect(s.every((id) => !BASE_CATALOG.items.find((i) => i.id === id)!.testOnly)).toBe(true);
    const everything = BASE_CATALOG.items.map((i) => i.id);
    expect(ids(everything)).toEqual([]); // nothing left to offer
  });

  it('ranks best sellers by quantity sold', () => {
    const o = (itemId: string, qty: number) => ({ lines: [{ itemId, qty }] });
    expect(bestSellers([o('masala-tea', 1), o('medu-vada', 3), o('masala-tea', 1), o('plain-dosa', 3)])).toEqual([
      'medu-vada',
      'plain-dosa',
      'masala-tea',
    ]);
  });
});
