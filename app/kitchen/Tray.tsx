'use client';
// The bottom strip: how many of each dish are still to be made, across every order on the rail.
import { useMemo } from 'react';
import { photoFor, placeholderFor, type Catalog, type MenuItem } from '@/lib/menu';
import { givenOf, type Order } from '@/lib/orders';
import { Flame } from './icons';

export function Tray({
  rail,
  dishes,
  menu,
  children,
}: {
  rail: Order[];
  dishes: Map<string, MenuItem>;
  menu: Catalog;
  children?: React.ReactNode;
}) {
  const tray = useMemo(() => {
    // grouped by section, in the menu's own order of sections
    const place = (id: string) => {
      const at = menu.cats.findIndex((c) => c.id === dishes.get(id)?.cat);
      return at < 0 ? menu.cats.length : at;
    };
    const m = new Map<string, number>();
    // what is still to be made: dishes already given (ticked) are off the tray
    for (const o of rail) {
      const given = givenOf(o);
      o.lines.forEach((l, i) => m.set(l.itemId, (m.get(l.itemId) ?? 0) + l.qty - given[i]));
    }
    return [...m.entries()].filter(([, n]) => n > 0).sort((a, b) => place(a[0]) - place(b[0]));
  }, [rail, dishes, menu]);

  return (
    <div className="tray">
      <div className="onfire">
        <Flame />
      </div>
      {tray.length === 0 && <span className="quiet">Nothing on the tawa</span>}
      {tray.map(([id, n]) => {
        const dish = dishes.get(id);
        const src = photoFor(dish);
        return (
          <div className="dish" key={id} title={dish?.name}>
            {src ? <img src={src} alt="" /> : <div className="ph">{placeholderFor(dish)}</div>}
            <b>{n}</b>
          </div>
        );
      })}
      {children}
    </div>
  );
}
