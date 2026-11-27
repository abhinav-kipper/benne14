'use client';
// Start screen: one tap anywhere begins an order.
import { useCatalog } from '@/components/Catalog';
import { useHoldToReload } from '@/lib/client';
import { photoFor } from '@/lib/menu';
import { Mascots } from './Mascots';
import { Chevron } from './shared';

const MOSAIC = [
  'masala-dosa',
  'medu-vada',
  'thatte-idli',
  'mallige-idli',
  'ghee-podi-benne-dosa',
  'masala-tea',
  'plain-benne-dosa',
  'ghee-podi-thatte-idli',
  'plain-dosa',
];

export function Home({ onStart }: { onStart: () => void }) {
  // Nine photos of what is on the menu now. The arrangement the owner approved comes first; a dish
  // taken off the menu gives its place to another dish with a photo (the owner's own included).
  const catalog = useCatalog();
  const holdLogo = useHoldToReload(); // staff: hold the logo five seconds to restart the screen
  const onMenu = new Map(catalog.items.filter((i) => !i.testOnly && photoFor(i)).map((i) => [i.id, photoFor(i)!]));
  const spare = [...onMenu.keys()].filter((id) => !MOSAIC.includes(id));
  const pool = [...onMenu.keys()];
  const shots = MOSAIC.map((id, n) =>
    onMenu.has(id)
      ? onMenu.get(id)!
      : pool.length
        ? onMenu.get(spare.shift() ?? pool[n % pool.length])!
        : `/food/${id}.jpg`,
  );
  const cols = [shots.slice(0, 3), shots.slice(3, 6), shots.slice(6, 9)];
  return (
    <div className="screen k-home" onClick={onStart}>
      <div className="top">
        <div className="logo" {...holdLogo}>
          <img src="/brand/benne14-logo.webp" alt="Benne 14 — Authentic Bangalore Dosa" draggable={false} />
        </div>
      </div>
      <div className="mosaic">
        {cols.map((c, i) => (
          <div className="col" key={i}>
            {c.map((src, n) => (
              <img key={n} src={src} alt="" />
            ))}
          </div>
        ))}
      </div>
      <div className="copy">
        <h1 className="disp">
          Fresh off
          <br />
          the <em>tawa.</em>
        </h1>
      </div>
      <Mascots />
      <button className="start" data-testid="start">
        <b>Tap to order</b>
        <span className="arr">
          <Chevron />
        </span>
      </button>
    </div>
  );
}
