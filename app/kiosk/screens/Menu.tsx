'use client';
// The menu: categories on the left, the house special, then every dish with its quick + / − stepper.
import { useLayoutEffect, useRef, useState } from 'react';
import { useCatalog } from '@/components/Catalog';
import { CATEGORIES, visibleItems, type MenuItem } from '@/lib/menu';
import { Photo, type Line } from './shared';

export function MenuScreen(p: {
  qtyOf: (id: string) => number;
  onOpen: (id: string) => void;
  lines: Line[];
  setQty: (uid: string, q: number) => void;
  count: number;
  total: number;
  onCart: () => void;
  testMode: boolean;
  // where the customer was (scroll position and lit section), kept while they visit the cart
  scrollMemo: { current: { top: number; cat: string | null } };
}) {
  const catalog = useCatalog();
  const items = visibleItems(p.testMode, catalog);
  const cats = CATEGORIES.filter((c) => items.some((i) => i.cat === c.id));
  const [active, setActiveState] = useState(cats.find((c) => c.id === p.scrollMemo.current.cat)?.id ?? cats[0].id);
  const setActive = (id: typeof active) => {
    p.scrollMemo.current.cat = id;
    setActiveState(id);
  };
  const main = useRef<HTMLElement>(null);
  const sp = items.find((i) => i.special)!;

  // + opens the dish's sheet (extras, notes), so every dish is added the same way and each customised dish is
  // its own line. Once a dish is in the order, the − 1 + stepper adjusts its latest line.
  const stepper = (i: MenuItem) => {
    if (i.soldOut) return <span className="soldout">Sold out</span>;
    const q = p.qtyOf(i.id);
    if (!q)
      return (
        <button
          className="add"
          aria-label={`Add ${i.name}`}
          onClick={(e) => {
            e.stopPropagation();
            p.onOpen(i.id);
          }}
        >
          +
        </button>
      );
    const last = [...p.lines].reverse().find((l) => l.itemId === i.id)!;
    return (
      <div className="step" onClick={(e) => e.stopPropagation()}>
        <button aria-label="less" onClick={() => p.setQty(last.uid, last.qty - 1)}>
          −
        </button>
        <span>{q}</span>
        <button aria-label="more" onClick={() => p.setQty(last.uid, last.qty + 1)}>
          +
        </button>
      </div>
    );
  };

  // A section the customer tapped (or came back to) stays lit until they move the list by hand: the glide
  // towards it must not re-light sections on the way, however slowly a busy tablet draws it.
  const tapped = useRef(false);
  // Back from the cart: the menu is where the customer left it, not at the top again.
  useLayoutEffect(() => {
    const m = main.current;
    if (!m || !p.scrollMemo.current.top) return;
    // the section that was lit stays lit: don't let this jump's own scroll event re-read it
    tapped.current = true;
    m.style.scrollBehavior = 'auto';
    m.scrollTop = p.scrollMemo.current.top;
    m.style.scrollBehavior = '';
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the menu comes back
  }, []);

  // Which section is showing. A tapped section lights up at once and stays lit while the list glides to it
  // (the last section is too short to reach the top, so position alone would never light it).
  const onScroll = () => {
    const m = main.current;
    if (!m) return;
    p.scrollMemo.current.top = m.scrollTop;
    if (tapped.current) return;
    let cur = cats[0].id;
    for (const c of cats) {
      const el = m.querySelector<HTMLElement>(`#cat-${c.id}`);
      if (el && el.offsetTop - 120 <= m.scrollTop) cur = c.id;
    }
    if (m.scrollTop >= m.scrollHeight - m.clientHeight - 2) cur = cats[cats.length - 1].id; // at the very end
    setActive(cur);
  };
  const goTo = (id: typeof active) => {
    const m = main.current;
    if (!m) return;
    tapped.current = true;
    setActive(id);
    // the first section starts at the very top, with the house special
    if (id === cats[0].id) m.scrollTo({ top: 0, behavior: 'smooth' });
    else m.querySelector(`#cat-${id}`)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="screen k-menu">
      <aside>
        <div className="brand">
          <div className="w">
            Benne
            <br />
            <i>14</i>
          </div>
          <small>
            Authentic
            <br />
            Bangalore Dosa
          </small>
        </div>
        <div className="cats">
          {cats.map((c) => (
            <button key={c.id} className={`cat ${active === c.id ? 'on' : ''}`} onClick={() => goTo(c.id)}>
              <div className="n disp">{c.name}</div>
            </button>
          ))}
        </div>
      </aside>
      <main
        ref={main}
        onScroll={onScroll}
        onPointerDown={() => (tapped.current = false)}
        onWheel={() => (tapped.current = false)}
      >
        <section
          className={`hero ${sp.soldOut ? 'out' : ''}`}
          onClick={() => {
            if (!sp.soldOut) p.onOpen(sp.id);
          }}
          data-testid="hero"
        >
          <Photo item={sp} />
          <div className="txt">
            <span className="chip">House special</span>
            <h1 className="disp">{sp.name}</h1>
            <div className="meta">
              <p className="hdesc">{sp.desc}</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
                <div>
                  <span className="price">₹{sp.price}</span>
                </div>
                {stepper(sp)}
              </div>
            </div>
          </div>
        </section>
        <section className="list">
          {cats.map((c, n) => (
            <div key={c.id}>
              <div className="sec" id={`cat-${c.id}`}>
                <h3 className="disp">{c.name}</h3>
                {/* said once, where prices start, so the total with GST is no surprise */}
                {n === 0 && <span className="gst">Prices + 5% GST</span>}
              </div>
              {items
                .filter((i) => i.cat === c.id && !i.special)
                .map((i) => (
                  <div
                    className={`item ${i.soldOut ? 'out' : ''}`}
                    key={i.id}
                    role="button"
                    aria-disabled={i.soldOut}
                    onClick={() => {
                      if (!i.soldOut) p.onOpen(i.id);
                    }}
                    data-testid={`item-${i.id}`}
                  >
                    <div className="ph">
                      <Photo item={i} />
                    </div>
                    <div>
                      <h4>{i.name}</h4>
                      <p className="hdesc">{i.desc}</p>
                      <span className="price">₹{i.price}</span>
                    </div>
                    {stepper(i)}
                  </div>
                ))}
            </div>
          ))}
        </section>
      </main>
      <div className="shade" />
      {p.count > 0 && (
        <button className="cartbar" key={p.count} onClick={p.onCart} data-testid="cartbar">
          <div className="count">
            <b>{p.count}</b>
            {p.count === 1 ? 'item' : 'items'}
          </div>
          <div className="go">
            <small>VIEW ORDER</small>
            <span className="tot">
              ₹{p.total}
              <small>incl. GST</small>
            </span>
            <span className="arrow">→</span>
          </div>
        </button>
      )}
    </div>
  );
}
