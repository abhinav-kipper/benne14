'use client';
// The menu: categories on the left, the house special, then every dish with its quick + / − stepper.
import { useRef, useState } from 'react';
import { useCatalog } from '@/components/Catalog';
import { CATEGORIES, visibleItems, type MenuItem } from '@/lib/menu';
import { Photo, type Line } from './shared';

export function MenuScreen(p: {
  qtyOf: (id: string) => number;
  onOpen: (id: string) => void;
  onQuick: (id: string) => void;
  onStartOver: () => void;
  lines: Line[];
  setQty: (uid: string, q: number) => void;
  count: number;
  total: number;
  onCart: () => void;
  testMode: boolean;
}) {
  const catalog = useCatalog();
  const items = visibleItems(p.testMode, catalog);
  const cats = CATEGORIES.filter((c) => items.some((i) => i.cat === c.id));
  const [active, setActive] = useState(cats[0].id);
  const main = useRef<HTMLElement>(null);
  const sp = items.find((i) => i.special)!;

  // + adds the dish as it comes with one tap and becomes the − 1 + stepper; tapping the dish itself opens the
  // sheet for extras and notes. The stepper adjusts the latest line for that dish.
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
            p.onQuick(i.id);
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

  const onScroll = () => {
    const m = main.current;
    if (!m) return;
    let cur = cats[0].id;
    for (const c of cats) {
      const el = m.querySelector<HTMLElement>(`#cat-${c.id}`);
      if (el && el.offsetTop - 120 <= m.scrollTop) cur = c.id;
    }
    setActive(cur);
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
            <button
              key={c.id}
              className={`cat ${active === c.id ? 'on' : ''}`}
              onClick={() => main.current?.querySelector(`#cat-${c.id}`)?.scrollIntoView({ behavior: 'smooth' })}
            >
              <div className="n disp">{c.name}</div>
            </button>
          ))}
        </div>
        <button className="startover" onClick={p.onStartOver} data-testid="start-over">
          Start over
        </button>
      </aside>
      <main ref={main} onScroll={onScroll}>
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
        <button className="cartbar" onClick={p.onCart} data-testid="cartbar">
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
