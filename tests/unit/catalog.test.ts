import { describe, expect, it } from 'vitest';
import { BASE_CATALOG, itemById, mergeCatalog } from '@/lib/menu';
import { priceOrder } from '@/lib/pricing';

describe("owner's menu changes", () => {
  const cat = mergeCatalog({
    items: {
      'masala-dosa': { price: 219, name: 'Masala Dosa (Large)', desc: null, soldOut: false },
      'plain-dosa': { soldOut: true },
    },
    options: { 'dosaExtras:benne': 30 },
  });

  it('merge on top of the menu in code without changing it', () => {
    expect(itemById('masala-dosa', cat)).toMatchObject({
      price: 219,
      name: 'Masala Dosa (Large)',
      desc: itemById('masala-dosa', BASE_CATALOG)!.desc,
    });
    expect(itemById('plain-dosa', cat)!.soldOut).toBe(true);
    expect(itemById('masala-dosa', BASE_CATALOG)!.price).toBe(209);
    expect(BASE_CATALOG.groups.dosaExtras.options[0].price).toBe(25);
  });

  it('new prices reach the bill, extras included, and the name is snapshotted', () => {
    const o = priceOrder([{ itemId: 'masala-dosa', qty: 1, choices: { dosaExtras: ['benne'] }, notes: [] }], cat);
    expect(o.lines[0]).toMatchObject({ unitPrice: 249, name: 'Masala Dosa (Large)' });
    expect(o.total).toBe(249 + 12);
  });

  it('an empty override changes nothing', () => {
    expect(mergeCatalog({ items: {}, options: {} }).items).toEqual(BASE_CATALOG.items);
  });
});
