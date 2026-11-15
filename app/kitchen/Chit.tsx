'use client';
// One order on the rail: a paper chit with a line per dish, ticked as each dish is given.
import { useEffect, useRef } from 'react';
import { noteTone, optionTone, type Catalog, type Tone } from '@/lib/menu';
import { allGiven, givenOf, minutesSince, type Order } from '@/lib/orders';
import { Bag, Check, Dine, Flame } from './icons';

const UNSTARTED_MIN = 3; // a new order nobody has started for this long flashes
const WARN_MIN = 8;
const LATE_MIN = 12;
const HOLD_MS = 550;

export function Chit({
  o,
  now,
  fresh,
  onGo,
  onTick,
  menu,
}: {
  o: Order;
  now: number;
  fresh: boolean;
  onGo: () => void;
  onTick: (line: number, by: 1 | -1) => void;
  menu: Catalog;
}) {
  const given = givenOf(o);
  const all = allGiven(o);
  // A hold (not a tap) on a line takes one tick back. The tap that ends a hold is swallowed.
  const hold = useRef<{ t: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const held = useRef(false);
  const endHold = () => {
    if (hold.current) clearTimeout(hold.current.t);
    hold.current = null;
  };
  useEffect(() => endHold, []);
  const m = minutesSince(o.paidAt ?? o.createdAt, now);
  const age = m >= LATE_MIN ? 'late' : m >= WARN_MIN ? 'warn' : '';
  return (
    <div
      className={`chit ${o.status} ${age} ${fresh ? 'fresh' : ''} ${o.status === 'new' && m >= UNSTARTED_MIN ? 'waiting' : ''}`}
      data-testid={`chit-${o.token}`}
    >
      <span className="clip" />
      <div className="age">
        <i style={{ width: `${Math.min(100, (m / 15) * 100)}%` }} />
      </div>
      <div className="ch-h">
        <span className="tok">{o.token}</span>
        {o.type === 'dine_in' ? <Dine /> : <Bag />}
        <span className="min">
          {m}
          <small>min</small>
        </span>
      </div>
      {o.customerName && <div className="who">{o.customerName}</div>}
      <div className="perf" />
      <div className="items">
        {o.lines.map((l, i) => {
          const tags = lineTags(l, menu);
          return (
            <div
              className={`ln ${given[i] === l.qty ? 'given' : given[i] > 0 ? 'part' : ''}`}
              key={i}
              role="button"
              tabIndex={0}
              aria-label={`${l.name}: ${given[i]} of ${l.qty} given`}
              data-testid={`ln-${o.token}-${i}`}
              onClick={() => {
                if (held.current) held.current = false;
                else onTick(i, 1);
              }}
              onKeyDown={(e) => e.key === 'Enter' && onTick(i, 1)}
              onPointerDown={(e) => {
                endHold();
                held.current = false;
                hold.current = {
                  x: e.clientX,
                  y: e.clientY,
                  t: setTimeout(() => {
                    hold.current = null;
                    if (given[i] === 0) return;
                    held.current = true;
                    onTick(i, -1);
                  }, HOLD_MS),
                };
              }}
              onPointerMove={(e) => {
                const h = hold.current; // a finger that moves is scrolling, not holding
                if (h && Math.abs(e.clientX - h.x) + Math.abs(e.clientY - h.y) > 12) endHold();
              }}
              onPointerUp={endHold}
              onPointerLeave={endHold}
              onPointerCancel={endHold}
              onContextMenu={(e) => e.preventDefault()}
            >
              <span className={`qty ${l.qty === 1 ? 'one' : ''}`}>{given[i] === l.qty ? <Check /> : l.qty}</span>
              <div>
                <div className="nm">{l.name}</div>
                {given[i] > 0 && given[i] < l.qty && (
                  <div className="gv" data-testid={`gv-${o.token}-${i}`}>
                    {given[i]} of {l.qty} given
                  </div>
                )}
                {tags.length > 0 && (
                  <div className="tags">
                    {tags.map((t) => (
                      <span
                        className={`tg ${t.tone === 'add' ? 'more' : t.tone === 'less' ? 'less' : 'note'}`}
                        key={t.key}
                      >
                        {t.tone && <i>{t.tone === 'add' ? '+' : '−'}</i>}
                        {t.text}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <button
        className={`go ${all && o.status === 'cooking' ? 'all' : ''}`}
        onClick={onGo}
        data-testid={`go-${o.token}`}
      >
        {o.status === 'new' ? (
          <>
            <Flame />
            Start
          </>
        ) : (
          <>
            <Check />
            Ready
          </>
        )}
      </button>
    </div>
  );
}

// What the cook reads under a dish: extras and "more" in green (+), "less / no" in red (−), other notes in black.
// Regular sugar is the default, so it doesn't show. (Spice was dropped; old orders may still carry it.)
function lineTags(l: Order['lines'][number], menu: Catalog): { key: string; text: string; tone?: Tone }[] {
  const mods = l.mods
    .map((m) => ({
      key: `${m.groupId}:${m.id}`,
      text: m.groupId === 'spice' ? `${m.name} spice` : m.name,
      tone: optionTone(m.groupId, m.id, menu) ?? (m.price > 0 ? ('add' as const) : undefined),
    }))
    .filter((t) => t.tone);
  const notes = l.notes.map((n) => ({ key: `note:${n.id}`, text: n.label, tone: noteTone(n.id, menu) }));
  const rank = (t: { tone?: Tone }) => (t.tone === 'add' ? 0 : t.tone === 'less' ? 1 : 2);
  return [...mods, ...notes].sort((a, b) => rank(a) - rank(b));
}
