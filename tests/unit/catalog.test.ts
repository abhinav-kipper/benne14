import { describe, expect, it } from 'vitest';
import {
  BASE_CATALOG,
  isCustomId,
  itemById,
  mergeCatalog,
  mergeSections,
  isSectionId,
  notesFor,
  photoFor,
  type CustomItem,
  type Overrides,
} from '@/lib/menu';
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

describe("the owner's own dishes, hidden dishes and the order of the menu", () => {
  const dish = (over: Partial<CustomItem> = {}): CustomItem => ({
    id: 'c-onion00001',
    cat: 'dosa',
    name: 'Onion Benne Dosa',
    desc: 'Crisp, with onion.',
    price: 179,
    groups: ['dosaExtras', 'no-such-group'],
    photo: 'https://example.test/p.jpg',
    live: true,
    ...over,
  });
  const o = (x: Partial<Overrides>): Overrides => ({ items: {}, options: {}, ...x });

  it('a published dish is on the menu like any other, and can be priced', () => {
    const cat = mergeCatalog(o({ custom: [dish()] }));
    const it = itemById('c-onion00001', cat)!;
    expect(it).toMatchObject({
      name: 'Onion Benne Dosa',
      price: 179,
      cat: 'dosa',
      custom: true,
      groups: ['dosaExtras'],
    });
    expect(photoFor(it)).toBe('https://example.test/p.jpg');
    expect(notesFor(it).map((n) => n.id)).toEqual(['less-oil', 'extra-crisp']); // made on the tawa like the others
    const line = { itemId: it.id, qty: 2, choices: { dosaExtras: ['benne'] }, notes: ['less-oil'] };
    expect(priceOrder([line], cat).subtotal).toBe(2 * (179 + 25));
  });

  it('a draft and a hidden dish are not on the menu, so they cannot be ordered', () => {
    const cat = mergeCatalog(o({ custom: [dish({ live: false })], hidden: ['masala-dosa'] }));
    expect(itemById('c-onion00001', cat)).toBeUndefined();
    expect(itemById('masala-dosa', cat)).toBeUndefined();
    expect(() => priceOrder([{ itemId: 'masala-dosa', qty: 1, choices: {}, notes: [] }], cat)).toThrow();
    expect(() => priceOrder([{ itemId: 'c-onion00001', qty: 1, choices: {}, notes: [] }], cat)).toThrow();
    // the owner still sees both, marked
    const all = mergeCatalog(o({ custom: [dish({ live: false })], hidden: ['masala-dosa'] }), true);
    expect(itemById('c-onion00001', all)).toMatchObject({ draft: true });
    expect(itemById('masala-dosa', all)).toMatchObject({ hidden: true });
  });

  it("follows the owner's order; dishes not mentioned keep their usual order after it", () => {
    const base = BASE_CATALOG.items.filter((i) => i.cat === 'dosa').map((i) => i.id);
    const cat = mergeCatalog(o({ custom: [dish()], order: ['plain-dosa', 'c-onion00001'] }));
    const dosas = cat.items.filter((i) => i.cat === 'dosa').map((i) => i.id);
    expect(dosas).toEqual(['plain-dosa', 'c-onion00001', ...base.filter((id) => id !== 'plain-dosa')]);
  });

  it('sold out today works on an added dish; its name and price come only from the dish itself', () => {
    const cat = mergeCatalog(
      o({ custom: [dish()], items: { 'c-onion00001': { soldOut: true, price: 1, name: 'X' } } }),
    );
    expect(itemById('c-onion00001', cat)).toMatchObject({ soldOut: true, price: 179, name: 'Onion Benne Dosa' });
  });

  it('knows an id it made from one it did not', () => {
    expect(isCustomId('c-onion00001')).toBe(true);
    for (const bad of ['masala-dosa', 'c-', 'c-ABC12345', 'c-abc', "c-abc123'; drop", 7, null])
      expect(isCustomId(bad)).toBe(false);
  });
});

describe("the owner's sections", () => {
  const lay = {
    custom: [{ id: 's-sweets01', name: 'Sweets' }],
    names: { dosa: 'Dosa', idli: '' },
    order: ['drinks', 's-sweets01'],
    hidden: ['idli'],
  };
  const sweet: CustomItem = {
    id: 'c-kesari0001',
    cat: 's-sweets01',
    name: 'Kesari Bath',
    desc: '',
    price: 79,
    groups: [],
    photo: null,
    live: true,
  };

  it('with no changes the sections are the ones that came with the app, the payment test last', () => {
    expect(mergeSections(undefined).map((c) => c.id)).toEqual(['dosa', 'idli', 'drinks', 'test']);
    expect(mergeCatalog({ items: {}, options: {} }).cats).toEqual(BASE_CATALOG.cats);
  });

  it("follows the owner's order and names; a hidden section is left out, an empty name keeps the old one", () => {
    expect(mergeSections(lay).map((c) => [c.id, c.name])).toEqual([
      ['drinks', 'Coffee & Tea'],
      ['s-sweets01', 'Sweets'],
      ['dosa', 'Dosa'],
      ['test', 'Payment test'],
    ]);
    const all = mergeSections(lay, true);
    expect(all.find((c) => c.id === 'idli')).toMatchObject({ hidden: true, name: 'Idli & Vada' });
    expect(all.find((c) => c.id === 's-sweets01')).toMatchObject({ custom: true });
  });

  it('a hidden section takes its dishes off the menu, so they cannot be ordered', () => {
    const cat = mergeCatalog({ items: {}, options: {}, custom: [sweet], sections: lay });
    expect(itemById('mallige-idli', cat)).toBeUndefined();
    expect(() => priceOrder([{ itemId: 'mallige-idli', qty: 1, choices: {}, notes: [] }], cat)).toThrow();
    expect(itemById('c-kesari0001', cat)).toMatchObject({ cat: 's-sweets01', notes: false });
    expect(priceOrder([{ itemId: 'c-kesari0001', qty: 2, choices: {}, notes: [] }], cat).subtotal).toBe(158);
    // the owner still sees them
    expect(itemById('mallige-idli', mergeCatalog({ items: {}, options: {}, sections: lay }, true))).toBeDefined();
  });

  it('a dish whose section no longer exists is not on the menu', () => {
    const cat = mergeCatalog({ items: {}, options: {}, custom: [{ ...sweet, cat: 's-gone00001' }] });
    expect(itemById('c-kesari0001', cat)).toBeUndefined();
  });

  it('knows a section id it made', () => {
    expect(isSectionId('s-sweets01')).toBe(true);
    for (const bad of ['dosa', 'test', 's-', 's-AB12cd34', 7, null]) expect(isSectionId(bad)).toBe(false);
  });
});
