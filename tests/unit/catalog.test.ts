import { describe, expect, it } from 'vitest';
import {
  BASE_CATALOG,
  dishSetId,
  extrasOf,
  isCustomId,
  itemById,
  mergeCatalog,
  mergeSections,
  noteTone,
  optionTone,
  type ExtrasLayout,
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
    expect(notesFor(it).map((n) => n.id)).toEqual([]);
    const line = { itemId: it.id, qty: 2, choices: { dosaExtras: ['benne'] }, notes: [] };
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

describe("the owner's own photo of a dish that came with the app", () => {
  const o = (photos: Record<string, string>): Overrides => ({ items: {}, options: {}, extras: { photos } });
  const own = 'https://shop.test/storage/v1/object/public/dish-photos/a.jpg';

  it('replaces the photo that came with the app, on that dish only', () => {
    const cat = mergeCatalog(o({ 'masala-dosa': own }));
    expect(photoFor(itemById('masala-dosa', cat))).toBe(own);
    expect(photoFor(itemById('plain-dosa', cat))).toBe('/food/plain-dosa.jpg');
    expect(photoFor(itemById('masala-dosa', mergeCatalog(o({}))))).toBe('/food/masala-dosa.jpg'); // taken away: the original
  });

  it('changes nothing else about the dish, and cannot touch the payment test or an unknown dish', () => {
    const { photo: _p, ...withOwn } = itemById('masala-dosa', mergeCatalog(o({ 'masala-dosa': own })))!;
    const { photo: _q, ...plain } = itemById('masala-dosa', BASE_CATALOG)!;
    expect(withOwn).toEqual(plain);
    const all = mergeCatalog(o({ 'test-1': own, 'no-such-dish': own }), true);
    expect(itemById('test-1', all)?.photo).toBeUndefined();
    expect(all.items.some((i) => i.id === 'no-such-dish')).toBe(false);
    // the order is priced exactly as before
    const line = [{ itemId: 'masala-dosa', qty: 1, choices: {}, notes: [] }];
    expect(priceOrder(line, mergeCatalog(o({ 'masala-dosa': own }))).total).toBe(priceOrder(line).total);
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

describe("the owner's extras and kitchen notes", () => {
  const extras: ExtrasLayout = {
    options: {
      dosaExtras: [{ id: 'x-cheese01', name: 'Extra cheese', price: 30 }],
      'g-ontop001': [{ id: 'x-icecrm01', name: 'Ice cream', price: 40 }],
    },
    names: { 'dosaExtras:podi': 'Extra gunpowder' },
    hidden: ['dosaExtras:palya', 'sugar:regular'],
    sets: [
      { id: 'g-ontop001', name: 'Add on top' },
      { id: 'g-empty001', name: 'Empty' },
    ],
    dishSets: { 'masala-tea': ['g-ontop001', 'sugar'], 'plain-dosa': ['g-empty001'], 'mallige-idli': ['no-such-set'] },
    notes: [{ id: 'n-noonion1', label: 'No onion', tone: 'less', cats: ['dosa', 'drinks'] }],
    hiddenNotes: ['potato-side'],
  };
  const cat = mergeCatalog({ items: {}, options: { 'dosaExtras:benne': 35 }, extras });
  const all = mergeCatalog({ items: {}, options: { 'dosaExtras:benne': 35 }, extras }, true);
  const line = (itemId: string, choices: Record<string, string[]> = {}, notes: string[] = []) => ({
    itemId,
    qty: 1,
    choices,
    notes,
  });

  it("adds the owner's extras to a set, renames, reprices, and leaves switched-off ones out", () => {
    expect(cat.groups.dosaExtras.options.map((o) => [o.id, o.name, o.price])).toEqual([
      ['benne', 'Extra benne', 35],
      ['podi', 'Extra gunpowder', 15],
      ['sambar', 'Extra sambhar', 20],
      ['x-cheese01', 'Extra cheese', 30],
    ]);
    expect(all.groups.dosaExtras.options.find((o) => o.id === 'palya')).toMatchObject({ hidden: true });
    expect(cat.groups.sugar.options).toHaveLength(3); // a choice with a default can't lose an option
    expect(priceOrder([line('masala-dosa', { dosaExtras: ['x-cheese01', 'benne'] })], cat).subtotal).toBe(
      209 + 30 + 35,
    );
    expect(() => priceOrder([line('masala-dosa', { dosaExtras: ['palya'] })], cat)).toThrow(); // switched off
    expect(priceOrder([line('masala-dosa', { dosaExtras: ['x-cheese01'] })], cat).lines[0].mods[0].name).toBe(
      'Extra cheese',
    );
  });

  it('a dish offers the sets the owner chose; an empty or missing set is not offered to customers', () => {
    expect(itemById('masala-tea', cat)!.groups).toEqual(['g-ontop001', 'sugar']);
    expect(priceOrder([line('masala-tea', { 'g-ontop001': ['x-icecrm01'] })], cat).subtotal).toBe(49 + 40);
    expect(itemById('plain-dosa', cat)!.groups).toEqual([]); // the set has nothing in it
    expect(itemById('plain-dosa', all)!.groups).toEqual(['g-empty001']); // the owner still sees the choice
    expect(itemById('mallige-idli', cat)!.groups).toEqual([]);
    expect(() => priceOrder([line('plain-dosa', { dosaExtras: ['benne'] })], cat)).toThrow(); // no longer offered
  });

  it("the owner's notes go to the sections picked; switched-off notes are gone; old notes keep their rules", () => {
    const ids = (id: string) => notesFor(itemById(id, cat)!, cat).map((n) => n.id);
    expect(ids('masala-dosa')).toEqual(['n-noonion1']);
    expect(notesFor(itemById('masala-dosa')!).map((n) => n.id)).toEqual(['potato-side']); // as the app ships
    expect(ids('masala-tea')).toEqual(['n-noonion1']); // drinks took no notes before
    expect(ids('mallige-idli')).toEqual([]);
    expect(priceOrder([line('masala-tea', {}, ['n-noonion1'])], cat).lines[0].notes).toEqual([
      { id: 'n-noonion1', label: 'No onion' },
    ]);
    expect(() => priceOrder([line('masala-dosa', {}, ['potato-side'])], cat)).toThrow();
    expect(() => priceOrder([line('masala-dosa', {}, ['extra-crisp'])], cat)).toThrow(); // retired for everyone
  });

  it("the kitchen colours them: the owner's extras green, notes as the owner said, even after they are switched off", () => {
    expect(optionTone('dosaExtras', 'x-cheese01', all)).toBe('add');
    expect(optionTone('dosaExtras', 'palya', all)).toBe('add');
    expect(noteTone('n-noonion1', all)).toBe('less');
    expect(noteTone('extra-crisp', all)).toBe('add'); // retired, but an old order's chit still colours
    expect(noteTone('extra-crisp')).toBe('add'); // with no menu loaded yet, the notes in code still colour
    expect(all.notes.map((n) => n.id)).toEqual(['potato-side', 'n-noonion1']); // the owner is not shown retired notes
  });
});

describe('a dish’s own extras and its “comes with” line', () => {
  const dish = {
    'masala-dosa': [
      { id: 'benne', name: 'Extra benne', price: 30 },
      { id: 'x-cheese01', name: 'Extra cheese', price: 40 },
      { id: 'potato-side', name: 'Potato stuffing on the side', price: 0 },
    ],
    'masala-tea': [{ id: 'x-ginger01', name: 'Extra ginger', price: 10 }],
    'plain-dosa': [],
  };
  const o = {
    items: {},
    options: {},
    extras: { dish, comesWith: { 'masala-dosa': 'Comes with two chutneys', 'plain-dosa': '' } },
  };
  const cat = mergeCatalog(o);
  const line = (itemId: string, choices: Record<string, string[]> = {}, notes: string[] = []) => ({
    itemId,
    qty: 1,
    choices,
    notes,
  });

  it('the dish offers exactly its own list, in one set; other dishes keep the shared ones', () => {
    const md = itemById('masala-dosa', cat)!;
    expect(md.groups).toEqual([dishSetId('masala-dosa')]);
    expect(cat.groups[dishSetId('masala-dosa')]).toMatchObject({ name: 'Make it extra', kind: 'many' });
    expect(extrasOf(md, cat)).toEqual(dish['masala-dosa']);
    expect(notesFor(md, cat)).toEqual([]); // the free choice is on the list now, not a separate note
    expect(itemById('plain-benne-dosa', cat)!.groups).toEqual(['dosaExtras']);
    expect(extrasOf(itemById('plain-benne-dosa', cat)!, cat).map((x) => x.id)).toEqual([
      'benne',
      'podi',
      'palya',
      'sambar',
    ]);
    // before any edit, masala dosa's list is its shared extras plus its free choice
    expect(extrasOf(itemById('masala-dosa')!, BASE_CATALOG).map((x) => [x.id, x.price])).toEqual([
      ['benne', 25],
      ['podi', 15],
      ['palya', 30],
      ['sambar', 20],
      ['potato-side', 0],
    ]);
  });

  it('a drink keeps its sugar choice next to its own extras; an empty list offers nothing', () => {
    expect(itemById('masala-tea', cat)!.groups).toEqual([dishSetId('masala-tea'), 'sugar']);
    expect(itemById('plain-dosa', cat)!.groups).toEqual([]); // nothing in it: not offered to customers
    expect(itemById('plain-dosa', mergeCatalog(o, true))!.groups).toEqual([dishSetId('plain-dosa')]);
  });

  it('prices from the dish’s list: paid extras add up, a free one costs nothing, the rest is refused', () => {
    const set = dishSetId('masala-dosa');
    const p = priceOrder([line('masala-dosa', { [set]: ['benne', 'x-cheese01', 'potato-side'] })], cat);
    expect(p.subtotal).toBe(209 + 30 + 40);
    expect(p.lines[0].mods.map((m) => [m.name, m.price])).toEqual([
      ['Extra benne', 30],
      ['Extra cheese', 40],
      ['Potato stuffing on the side', 0],
    ]);
    expect(() => priceOrder([line('masala-dosa', { dosaExtras: ['benne'] })], cat)).toThrow(); // the shared set
    expect(() => priceOrder([line('masala-dosa', { [set]: ['podi'] })], cat)).toThrow(); // taken off this dish
    expect(() => priceOrder([line('masala-dosa', {}, ['potato-side'])], cat)).toThrow(); // no longer a note
    expect(() => priceOrder([line('plain-benne-dosa', { [set]: ['x-cheese01'] })], cat)).toThrow(); // another dish's
    expect(priceOrder([line('plain-benne-dosa', { dosaExtras: ['benne'] })], cat).subtotal).toBe(159 + 25); // its own price
  });

  it('the kitchen colours a paid extra as an addition and leaves a free choice plain', () => {
    const set = dishSetId('masala-dosa');
    expect(optionTone(set, 'x-cheese01', cat)).toBe('add');
    expect(optionTone(set, 'potato-side', cat)).toBeUndefined();
  });

  it('“comes with”: the owner’s words, nothing when cleared, the usual line otherwise', () => {
    expect(itemById('masala-dosa', cat)!.comesWith).toBe('Comes with two chutneys');
    expect(itemById('plain-dosa', mergeCatalog(o, true))!.comesWith).toBeUndefined();
    expect(itemById('mallige-idli', cat)!.comesWith).toBe('Comes with coconut chutney & sambar');
    expect(itemById('masala-tea', cat)!.comesWith).toBeUndefined();
    expect(itemById('masala-dosa')!.comesWith).toBe('Comes with coconut chutney & sambar'); // the menu as it ships
  });
});
