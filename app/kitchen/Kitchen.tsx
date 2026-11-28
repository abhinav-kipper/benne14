'use client';
import { useEffect, useState } from 'react';
import { givenOf, type Order, type OrderStatus } from '@/lib/orders';
import { PinGate } from '@/components/PinGate';
import {
  api,
  ApiError,
  useAutoReload,
  useAwake,
  useFreshIds,
  useHoldToReload,
  useLiveOrders,
  useNightlyReload,
  useWatch,
} from '@/lib/client';
import { Check, List, Speaker, Undo } from './icons';
import { Chit } from './Chit';
import { History } from './History';
import { Pass } from './Pass';
import { Tray } from './Tray';
import { useKitchenMenu, useKitchenSound, useRailOverflow } from './hooks';

const DOWN_AFTER_MS = 20_000;
const PIN_KEY = 'benne14.staffPin';
const NARROW_FROM = 5; // this many orders on the rail → narrower chits, so five fit instead of four

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
  useNightlyReload();
  useAwake();
  useWatch('kitchen');
  const holdLogo = useHoldToReload();
  // A short blip only shows the small "reconnecting" note. After DOWN_AFTER_MS with no answer, new
  // orders are plainly not arriving: say so across the whole screen until the connection is back.
  const [down, setDown] = useState(false);
  useEffect(() => {
    if (online) {
      setDown(false);
      return;
    }
    const t = setTimeout(() => setDown(true), DOWN_AFTER_MS);
    return () => clearTimeout(t);
  }, [online]);

  const { wantSound, unlocked, toggleSound, flash } = useKitchenSound(orders);

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
  const [showHistory, setShowHistory] = useState(false);

  const { railRef, hidden, countHidden, scrollRail } = useRailOverflow(rail.length);
  const fresh = useFreshIds(list.map((o) => `${o.id}:${o.status === 'cooking' ? 'new' : o.status}`));
  const isFresh = (o: Order) => fresh.has(`${o.id}:${o.status === 'cooking' ? 'new' : o.status}`);
  const { dishes, menu } = useKitchenMenu(rail);
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
        <div className="logo" {...holdLogo}>
          Benne <i>14</i>
        </div>
        <button className={`ibtn ${wantSound ? 'on' : 'ask'}`} data-testid="sound" onClick={toggleSound}>
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
      {down && (
        <div className="netdown" role="alert" data-testid="netdown">
          <b>No connection: new orders are NOT arriving.</b> Check the Wi-Fi, or tell the counter to take orders by
          hand.
        </div>
      )}

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
                menu={menu}
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

      <Pass due={due} ready={ready} now={now} isFresh={isFresh} onMove={move} />

      <Tray rail={rail} dishes={dishes} menu={menu}>
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
      </Tray>

      {showHistory && (
        <History
          onClose={() => setShowHistory(false)}
          onRecall={(o) => move(o, 'ready', false)}
          onUnready={(o) => move(o, 'cooking', false)}
        />
      )}
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
