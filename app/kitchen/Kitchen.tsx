'use client';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { mergeCatalog, noteTone, optionTone, photoFor, placeholderFor, type MenuItem, type Tone } from '@/lib/menu';
import { allGiven, counts, givenOf, minutesSince, type Order, type OrderStatus } from '@/lib/orders';
import { PinGate } from '@/components/PinGate';
import { api, ApiError, chime, useAutoReload, useFreshIds, useLiveOrders, useTodayOrders } from '@/lib/client';

const WARN_MIN = 8;
const LATE_MIN = 12;
const PIN_KEY = 'benne14.staffPin';
const SOUND_KEY = 'benne14.sound';
const NARROW_FROM = 5; // this many orders on the rail → narrower chits, so five fit instead of four

const Dine = () => (
  <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round">
    <circle cx="32" cy="34" r="20" />
    <circle cx="32" cy="34" r="11" />
    <path d="M6 12v14m0 0c0 3 4 3 4 0V12m-2 14v28M58 12c-4 4-4 14 0 16v26" />
  </svg>
);
const Bag = () => (
  <svg
    viewBox="0 0 64 64"
    fill="none"
    stroke="currentColor"
    strokeWidth="4"
    strokeLinejoin="round"
    strokeLinecap="round"
  >
    <path d="M12 22h40l-3 34H15z" />
    <path d="M23 22v-4a9 9 0 0 1 18 0v4" />
  </svg>
);
const Flame = () => (
  <svg viewBox="0 0 24 24">
    <path fill="currentColor" d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-4-1-6 1-9z" />
  </svg>
);
const Check = () => (
  <svg viewBox="0 0 24 24">
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M4 12.5l5 5L20 6.5"
    />
  </svg>
);
const Hand = () => (
  <svg viewBox="0 0 24 24">
    <g fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 15h4l5 3 7-4a1.6 1.6 0 0 0-1.6-2.6L13 13" />
      <path d="M8 13h4.5a1.5 1.5 0 0 0 0-3H9L6 9H3" />
    </g>
  </svg>
);
const Bell = () => (
  <svg viewBox="0 0 34 34">
    <g fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
      <path d="M5 26h24M7 26a10 10 0 0 1 20 0M17 13v3M14 10h6" />
    </g>
  </svg>
);
const Rupee = () => (
  <svg viewBox="0 0 34 34">
    <g fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="8" width="28" height="18" rx="3" />
      <path d="M13 13h8M13 17h8M15 13c5 0 5 6 0 6l5 4" />
    </g>
  </svg>
);
const Speaker = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 9v6h4l5 4V5L8 9z" />
    <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" />
  </svg>
);
const Undo = () => (
  <svg viewBox="0 0 24 24" width="16" height="16">
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9 7L4 12l5 5M4 12h10a6 6 0 0 1 0 12"
    />
  </svg>
);

const List = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <path d="M8 6h12M8 12h12M8 18h12" />
    <circle cx="4" cy="6" r="1" fill="currentColor" />
    <circle cx="4" cy="12" r="1" fill="currentColor" />
    <circle cx="4" cy="18" r="1" fill="currentColor" />
  </svg>
);

const UNDO_TEXT: Partial<Record<OrderStatus, string>> = {
  cooking: 'started',
  ready: 'ready',
  handed_over: 'handed over',
};

export default function Kitchen() {
  const [pin, setPin] = useState<string | null>(null);
  const [pinChecked, setPinChecked] = useState(false);
  const [pinNote, setPinNote] = useState<string | null>(null);
  useEffect(() => {
    setPin(localStorage.getItem(PIN_KEY));
    setPinChecked(true);
  }, []);

  const { orders, setOrders, online, refresh, noteLocalChange } = useLiveOrders(1500);
  // Clock starts in the browser only: a time rendered at build/server time would never match (React #418).
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  useAutoReload(); // orders live on the server, so the kitchen can reload as soon as a new version is out

  // Sound. The choice is remembered, but a browser only plays audio after a tap on the page, so after
  // every reload a bar asks for one tap anywhere. New orders also flash the screen, sound or not.
  const audio = useRef<AudioContext | null>(null);
  const [wantSound, setWantSound] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const soundOn = wantSound && unlocked;
  useEffect(() => {
    setWantSound(localStorage.getItem(SOUND_KEY) === '1');
  }, []);
  const unlock = useCallback(() => {
    audio.current ??= new AudioContext();
    audio.current.resume();
    setUnlocked(true);
  }, []);
  useEffect(() => {
    if (!wantSound || unlocked) return;
    const tap = () => {
      unlock();
      chime(audio.current, [660]);
    };
    window.addEventListener('pointerdown', tap, { once: true });
    return () => window.removeEventListener('pointerdown', tap);
  }, [wantSound, unlocked, unlock]);
  const [flash, setFlash] = useState(0);
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!orders) return;
    // Chime + flash for new kitchen orders and for UPI "I've paid" claims the counter must check.
    const fresh = orders
      .filter((o) => o.status === 'new' || o.status === 'awaiting_cash')
      .map((o) => `${o.id}:${o.status}`);
    if (seen.current && fresh.some((id) => !seen.current!.has(id))) {
      if (soundOn) chime(audio.current);
      setFlash((n) => n + 1);
    }
    seen.current = new Set([...(seen.current ?? []), ...fresh]);
  }, [orders, soundOn]);

  const [toast, setToast] = useState<{ text: string; undo?: { id: string; to: OrderStatus }; err?: boolean } | null>(
    null,
  );
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const move = async (o: Order, to: OrderStatus, undoable = true) => {
    if (!pin) return;
    const from = o.status;
    noteLocalChange();
    setOrders(
      (cur) =>
        cur?.map((x) =>
          x.id === o.id ? { ...x, status: to, readyAt: to === 'ready' ? new Date().toISOString() : x.readyAt } : x,
        ) ?? cur,
    );
    try {
      await api.setStatus(o.id, to, pin, from);
      noteLocalChange();
      setToast(
        undoable && UNDO_TEXT[to] ? { text: `Order ${o.token} ${UNDO_TEXT[to]}`, undo: { id: o.id, to: from } } : null,
      );
    } catch (e) {
      failed(e);
    }
    refresh();
  };
  const failed = (e: unknown) => {
    // Only a PIN the server now rejects (e.g. changed in Vercel) sends the cook back to the PIN screen.
    if (e instanceof ApiError && e.status === 401) {
      localStorage.removeItem(PIN_KEY);
      setPinNote('The PIN was changed. Enter the new PIN.');
      setPin(null);
    }
    setToast({ text: e instanceof ApiError ? e.message : 'No internet. Tap again.', err: true });
  };

  // A long order goes out in parts: a tap on a line counts one more of it as given, a hold takes one
  // back. Kept on the server so every kitchen screen agrees and a reload doesn't forget.
  const tick = async (o: Order, line: number, by: 1 | -1) => {
    if (!pin) return;
    const given = givenOf(o);
    const count = given[line] + by;
    if (count < 0) return;
    if (count > o.lines[line].qty) {
      setToast({ text: 'Already given. Hold the line to take a tick back.' });
      return;
    }
    given[line] = count;
    noteLocalChange();
    setOrders((cur) => cur?.map((x) => (x.id === o.id ? { ...x, given, status: 'cooking' } : x)) ?? cur);
    try {
      await api.setGiven(o.id, line, count, pin);
      noteLocalChange();
    } catch (e) {
      failed(e);
    }
    refresh();
  };

  const list = orders ?? [];
  const rail = list.filter((o) => o.status === 'new' || o.status === 'cooking');
  const ready = list
    .filter((o) => o.status === 'ready')
    .sort((a, b) => (b.readyAt ?? '').localeCompare(a.readyAt ?? ''));
  // Payment shelf: claimed / counter payments first, then UPI QRs still open on the kiosk.
  const due = [
    ...list.filter((o) => o.status === 'awaiting_cash'),
    ...list.filter((o) => o.status === 'pending_payment'),
  ];
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);

  // Shelf density: when the payment + ready cards don't fit the column, step down to smaller cards
  // (1 compact, 2 one-line rows, 3 two per row) so the oldest ready orders stay on screen.
  // It starts again from full size whenever the number of cards changes.
  const passRef = useRef<HTMLDivElement>(null);
  const shelfKey = `${due.length}:${ready.length}`;
  const [fit, setFit] = useState({ key: shelfKey, level: 0 });
  const density = fit.key === shelfKey ? fit.level : 0;
  useLayoutEffect(() => {
    const el = passRef.current;
    if (el && density < 3 && el.scrollHeight > el.clientHeight + 1) setFit({ key: shelfKey, level: density + 1 });
  }, [shelfKey, density]);
  const [showHistory, setShowHistory] = useState(false);

  // The rail scrolls sideways when it's full. Count the chits out of view on each side so a clear
  // "+3 more ›" tab can say so: the newest orders land at the far right.
  const railRef = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState({ left: 0, right: 0 });
  const countHidden = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    const view = el.getBoundingClientRect();
    let left = 0,
      right = 0;
    for (const c of el.querySelectorAll('.chit')) {
      const r = c.getBoundingClientRect();
      const mid = r.left + r.width / 2; // a chit counts as hidden once more than half of it is out of view
      if (mid < view.left) left++;
      else if (mid > view.right) right++;
    }
    setHidden((h) => (h.left === left && h.right === right ? h : { left, right }));
  }, []);
  useLayoutEffect(countHidden, [countHidden, rail.length]);
  const scrollRail = (dir: 1 | -1) =>
    railRef.current?.scrollBy({ left: dir * railRef.current.clientWidth * 0.8, behavior: 'smooth' });
  const fresh = useFreshIds(list.map((o) => `${o.id}:${o.status === 'cooking' ? 'new' : o.status}`));
  const isFresh = (o: Order) => fresh.has(`${o.id}:${o.status === 'cooking' ? 'new' : o.status}`);
  // The whole menu, hidden dishes included: an order placed before a dish was hidden still shows its photo.
  const [dishes, setDishes] = useState<Map<string, MenuItem>>(new Map());
  useEffect(() => {
    const load = () =>
      api
        .menu()
        .then((o) => setDishes(new Map(mergeCatalog(o, true).items.map((i) => [i.id, i]))))
        .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);
  const tray = useMemo(() => {
    const m = new Map<string, number>();
    // what is still to be made: dishes already given (ticked) are off the tray
    for (const o of rail) {
      const given = givenOf(o);
      o.lines.forEach((l, i) => m.set(l.itemId, (m.get(l.itemId) ?? 0) + l.qty - given[i]));
    }
    return [...m.entries()]
      .filter(([, n]) => n > 0)
      .sort((a, b) => (dishes.get(a[0])?.cat ?? '').localeCompare(dishes.get(b[0])?.cat ?? ''));
  }, [rail, dishes]);
  const clock = !now
    ? ''
    : new Date(now).toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Asia/Kolkata',
      });

  return (
    <div className="kitchen">
      <div className="top">
        <div className="logo">
          Benne <i>14</i>
        </div>
        <button
          className={`ibtn ${wantSound ? 'on' : 'ask'}`}
          data-testid="sound"
          onClick={() => {
            if (wantSound) {
              localStorage.setItem(SOUND_KEY, '0');
              setWantSound(false);
              return;
            }
            localStorage.setItem(SOUND_KEY, '1');
            unlock();
            setWantSound(true);
            chime(audio.current, [660]);
          }}
        >
          <Speaker />
          {wantSound ? 'Sound on' : 'Turn on sound'}
        </button>
        <button className="ibtn" onClick={() => setShowHistory(true)} data-testid="open-history">
          <List />
          Today&apos;s orders
        </button>
        {wantSound && !unlocked && (
          <span className="soundbar" data-testid="soundbar">
            Tap anywhere to turn the sound on
          </span>
        )}
        {!online && (
          <span className="net">
            <i />
            No internet, reconnecting…
          </span>
        )}
        <div className="clock">{clock}</div>
      </div>

      <div className="railcell">
        <div className="railwrap" ref={railRef} onScroll={countHidden}>
          <div className="rail" />
          <div className={`chits ${rail.length >= NARROW_FROM ? 'narrow' : ''}`}>
            {rail.map((o) => (
              <Chit
                key={o.id}
                o={o}
                now={now}
                fresh={isFresh(o)}
                onGo={() => move(o, o.status === 'new' ? 'cooking' : 'ready')}
                onTick={(line, by) => tick(o, line, by)}
              />
            ))}
          </div>
          {orders && rail.length === 0 && (
            <div className="empty">
              <div>
                <b>No orders right now</b>New orders drop onto this rail with a chime.
              </div>
            </div>
          )}
        </div>
        {hidden.left > 0 && (
          <button className="railtab left" onClick={() => scrollRail(-1)} data-testid="rail-earlier">
            ‹ <b>{hidden.left}</b> earlier
          </button>
        )}
        {hidden.right > 0 && (
          <button className="railtab right" onClick={() => scrollRail(1)} data-testid="rail-more">
            <b>+{hidden.right}</b> more ›
          </button>
        )}
      </div>
      {flash > 0 && <div className="flash" key={flash} />}

      <div className={`pass d${density}`} ref={passRef} data-testid="pass" data-density={density}>
        {due.length > 0 && (
          <>
            <div className="pass-h due">
              <Rupee />
              <b>Collect payment</b>
              <span>{due.length}</span>
            </div>
            <div className="shelf">
              {due.map((o) => (
                <div
                  className={`plate due ${o.status === 'pending_payment' ? 'open' : ''} ${isFresh(o) ? 'fresh' : ''}`}
                  key={o.id}
                  data-testid={`due-${o.token}`}
                >
                  <div className="row1">
                    <span className="tok">{o.token}</span>
                    {o.type === 'dine_in' ? <Dine /> : <Bag />}
                    <span className="w amt">₹{o.total}</span>
                  </div>
                  <div className="nm2">
                    <b className="how">
                      {o.payMethod === 'upi'
                        ? o.status === 'pending_payment'
                          ? 'UPI · QR still open'
                          : 'UPI · listen for the soundbox'
                        : o.payMethod === 'card'
                          ? 'Card machine'
                          : 'Cash'}
                    </b>
                    {o.customerName ? ` · ${o.customerName}` : ''} · {o.itemCount}{' '}
                    {o.itemCount === 1 ? 'item' : 'items'}
                  </div>
                  <div className="pay-actions">
                    <button onClick={() => move(o, 'new', false)}>
                      <Check />
                      Paid
                    </button>
                    <button
                      className="drop"
                      onClick={() => {
                        if (confirmCancel === o.id) {
                          setConfirmCancel(null);
                          move(o, 'cancelled', false);
                        } else setConfirmCancel(o.id);
                      }}
                    >
                      {confirmCancel === o.id ? 'Sure?' : 'Cancel'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="gap" />
          </>
        )}
        <div className="pass-h">
          <Bell />
          <b>Ready at counter</b>
          <span>{ready.length}</span>
        </div>
        <div className="shelf">
          {ready.map((o) => {
            const w = o.readyAt ? minutesSince(o.readyAt, now) : 0;
            return (
              <div className={`plate ${isFresh(o) ? 'fresh' : ''}`} key={o.id} data-testid={`ready-${o.token}`}>
                <div className="row1">
                  <span className="tok">{o.token}</span>
                  {o.type === 'dine_in' ? <Dine /> : <Bag />}
                  <span className="w">
                    <i className={w >= 3 ? 'long' : ''} />
                    {w} min
                  </span>
                </div>
                <div className="nm2">
                  {o.customerName ? `${o.customerName} · ` : ''}
                  {o.lines.map((l) => `${l.qty} × ${l.name}`).join(', ')}
                </div>
                <button onClick={() => move(o, 'handed_over')} aria-label={`Order ${o.token} handed over`}>
                  <Hand />
                  <span className="lbl">Handed over</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>

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
        {toast && (
          <div className={`toast ${toast.err ? 'err' : ''}`}>
            {!toast.err && <Check />}
            {toast.text}
            {toast.undo && (
              <button
                onClick={() => {
                  const u = toast.undo!;
                  const o = list.find((x) => x.id === u.id);
                  setToast(null);
                  if (o) move({ ...o, status: o.status }, u.to, false);
                }}
              >
                <Undo />
                Undo
              </button>
            )}
          </div>
        )}
      </div>

      {showHistory && <History onClose={() => setShowHistory(false)} onRecall={(o) => move(o, 'ready', false)} />}
      {pinChecked && !pin && (
        <PinGate
          title="Kitchen"
          note={pinNote}
          onPin={(p) => {
            localStorage.setItem(PIN_KEY, p);
            setPinNote(null);
            setPin(p);
          }}
        />
      )}
    </div>
  );
}

const HOLD_MS = 550;

function Chit({
  o,
  now,
  fresh,
  onGo,
  onTick,
}: {
  o: Order;
  now: number;
  fresh: boolean;
  onGo: () => void;
  onTick: (line: number, by: 1 | -1) => void;
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
    <div className={`chit ${o.status} ${age} ${fresh ? 'fresh' : ''}`} data-testid={`chit-${o.token}`}>
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
          const tags = lineTags(l);
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
function lineTags(l: Order['lines'][number]): { key: string; text: string; tone?: Tone }[] {
  const mods = l.mods
    .map((m) => ({
      key: `${m.groupId}:${m.id}`,
      text: m.groupId === 'spice' ? `${m.name} spice` : m.name,
      tone: optionTone(m.groupId, m.id) ?? (m.price > 0 ? ('add' as const) : undefined),
    }))
    .filter((t) => t.tone);
  const notes = l.notes.map((n) => ({ key: `note:${n.id}`, text: n.label, tone: noteTone(n.id) }));
  const rank = (t: { tone?: Tone }) => (t.tone === 'add' ? 0 : t.tone === 'less' ? 1 : 2);
  return [...mods, ...notes].sort((a, b) => rank(a) - rank(b));
}

const STATUS_TEXT: Record<OrderStatus, string> = {
  pending_payment: 'Not paid',
  awaiting_cash: 'Payment due',
  new: 'Waiting',
  cooking: 'Cooking',
  ready: 'Ready',
  handed_over: 'Collected',
  cancelled: 'Cancelled',
};
const PAY_TEXT = { upi: 'UPI', card: 'Card', cash: 'Cash' } as const;
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata',
  });

// Today's orders, newest first. Staff can bring a collected order back to the counter shelf.
function History({ onClose, onRecall }: { onClose: () => void; onRecall: (o: Order) => void }) {
  const orders = useTodayOrders(true, 5000);
  const list = orders ?? [];
  const paid = list.filter(counts); // the same rule as the owner's dashboard: paid, not refunded
  const takings = paid.reduce((a, o) => a + o.total, 0);
  // A long order is cut short in its row; a tap opens it in full (one dish per line, with extras and notes).
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="hist" data-testid="history">
      <div className="scrim" onClick={onClose} />
      <div className="panel">
        <div className="hh">
          <h2 className="disp">Today</h2>
          <div className="sum">
            <b>{paid.length}</b> paid orders<span>·</span>
            <b>₹{takings}</b>
          </div>
          <button className="x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="rows">
          {orders && list.length === 0 && <div className="none">No orders yet today.</div>}
          {list.map((o) => (
            <div
              className={`hr ${o.status} ${open === o.id ? 'open' : ''}`}
              key={o.id}
              data-testid={`hist-${o.token}`}
              onClick={() => setOpen(open === o.id ? null : o.id)}
            >
              <span className="tok">{o.token}</span>
              <div className="mid">
                <div className="l1">
                  <b>{time(o.createdAt)}</b>
                  {o.type === 'dine_in' ? 'Dine-in' : 'Takeaway'}
                  {o.customerName ? ` · ${o.customerName}` : ''}
                  <span className="more">
                    {o.itemCount} {o.itemCount === 1 ? 'item' : 'items'} {open === o.id ? '▴' : '▾'}
                  </span>
                </div>
                {open === o.id ? (
                  <ul className="full" data-testid={`hist-full-${o.token}`}>
                    {o.lines.map((l, i) => {
                      const extra = [
                        ...l.mods.filter((m) => m.price > 0).map((m) => m.name),
                        ...l.notes.map((n) => n.label),
                      ];
                      return (
                        <li key={i}>
                          <b>{l.qty} ×</b> {l.name}
                          {extra.length > 0 && <small>{extra.join(' · ')}</small>}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="l2">{o.lines.map((l) => `${l.qty} × ${l.name}`).join(', ')}</div>
                )}
              </div>
              <div className="amt">
                ₹{o.total}
                <small>{PAY_TEXT[o.payMethod]}</small>
              </div>
              <span className={`st ${o.status}`}>{STATUS_TEXT[o.status]}</span>
              {o.status === 'handed_over' ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation(); // not a tap on the row
                    onRecall(o);
                  }}
                >
                  Back to counter
                </button>
              ) : (
                <i />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
