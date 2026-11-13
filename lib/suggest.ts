// "Anything else?" in the cart: what to offer next to this order. Pure, so the same rule can be tested.
import type { Catalog, MenuItem } from './menu';

// What an order is most likely missing, in the order to offer it: a drink, then a side, then a dosa.
const OFFER_FIRST: MenuItem['cat'][] = ['drinks', 'idli', 'dosa'];

// Up to `n` dishes that are not in the order and not sold out. Sections the order has nothing from
// come first, one dish from each in turn, so a dosa order is offered a coffee and a vada rather than
// three more dosas. Within a section the shop's best sellers come first (`popular`: item ids, best
// first), then the menu's own order.
export function suggestFor(inCart: string[], catalog: Catalog, popular: string[] = [], n = 3): MenuItem[] {
  const have = new Set(inCart);
  const rank = (id: string) => {
    const i = popular.indexOf(id);
    return i < 0 ? popular.length : i;
  };
  const free = catalog.items.filter((i) => !i.testOnly && !i.soldOut && !have.has(i.id));
  const catsInCart = new Set(catalog.items.filter((i) => have.has(i.id)).map((i) => i.cat));
  const lists = (cats: MenuItem['cat'][]) =>
    cats.map((c) => free.filter((i) => i.cat === c).sort((a, b) => rank(a.id) - rank(b.id))).filter((l) => l.length);
  const out: MenuItem[] = [];
  // first everything the order has nothing from, section by section in turn; only then more of the same
  for (const sections of [
    lists(OFFER_FIRST.filter((c) => !catsInCart.has(c))),
    lists(OFFER_FIRST.filter((c) => catsInCart.has(c))),
  ])
    for (let round = 0; out.length < n && sections.some((s) => s[round]); round++)
      for (const s of sections) if (s[round] && out.length < n) out.push(s[round]);
  return out;
}

// Item ids by how many were sold, best first (paid orders; the caller picks the period).
export function bestSellers(orders: { lines: { itemId: string; qty: number }[] }[]): string[] {
  const sold = new Map<string, number>();
  for (const o of orders) for (const l of o.lines) sold.set(l.itemId, (sold.get(l.itemId) ?? 0) + l.qty);
  return [...sold.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id);
}
