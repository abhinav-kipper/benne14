'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { itemById, photoOf } from '@/lib/menu';
import { minutesSince, type Order, type OrderStatus } from '@/lib/orders';
import { api, ApiError, chime, useLiveOrders } from '@/lib/client';

const WARN_MIN = 8;
const LATE_MIN = 12;
const PIN_KEY = 'benne14.staffPin';

const Dine = () => <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round"><circle cx="32" cy="34" r="20" /><circle cx="32" cy="34" r="11" /><path d="M6 12v14m0 0c0 3 4 3 4 0V12m-2 14v28M58 12c-4 4-4 14 0 16v26" /></svg>;
const Bag = () => <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round"><path d="M12 22h40l-3 34H15z" /><path d="M23 22v-4a9 9 0 0 1 18 0v4" /></svg>;
const Flame = () => <svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-4-1-6 1-9z" /></svg>;
const Check = () => <svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" d="M4 12.5l5 5L20 6.5" /></svg>;
const Hand = () => <svg viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 15h4l5 3 7-4a1.6 1.6 0 0 0-1.6-2.6L13 13" /><path d="M8 13h4.5a1.5 1.5 0 0 0 0-3H9L6 9H3" /></g></svg>;
const Bell = () => <svg viewBox="0 0 34 34"><g fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M5 26h24M7 26a10 10 0 0 1 20 0M17 13v3M14 10h6" /></g></svg>;
const Rupee = () => <svg viewBox="0 0 34 34"><g fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="8" width="28" height="18" rx="3" /><path d="M13 13h8M13 17h8M15 13c5 0 5 6 0 6l5 4" /></g></svg>;
const Speaker = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" /></svg>;
const Undo = () => <svg viewBox="0 0 24 24" width="16" height="16"><path fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" d="M9 7L4 12l5 5M4 12h10a6 6 0 0 1 0 12" /></svg>;

const UNDO_TEXT: Partial<Record<OrderStatus, string>> = { cooking: 'शुरू किया', ready: 'तैयार', handed_over: 'दे दिया' };

export default function Kitchen() {
  const [pin, setPin] = useState<string | null>(null);
  const [pinChecked, setPinChecked] = useState(false);
  useEffect(() => { setPin(localStorage.getItem(PIN_KEY)); setPinChecked(true); }, []);

  const { orders, setOrders, online, refresh } = useLiveOrders(1500);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(t); }, []);

  // Sound: browsers only play audio after a tap, so the cook taps "आवाज़" once after opening.
  const audio = useRef<AudioContext | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!orders) return;
    const fresh = orders.filter((o) => o.status === 'new').map((o) => o.id);
    if (seen.current && soundOn && fresh.some((id) => !seen.current!.has(id))) chime(audio.current);
    seen.current = new Set([...(seen.current ?? []), ...fresh]);
  }, [orders, soundOn]);

  const [toast, setToast] = useState<{ text: string; undo?: { id: string; to: OrderStatus }; err?: boolean } | null>(null);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 6000); return () => clearTimeout(t); }, [toast]);

  const move = async (o: Order, to: OrderStatus, undoable = true) => {
    if (!pin) return;
    const from = o.status;
    setOrders((cur) => cur?.map((x) => (x.id === o.id ? { ...x, status: to, readyAt: to === 'ready' ? new Date().toISOString() : x.readyAt } : x)) ?? cur);
    try {
      await api.setStatus(o.id, to, pin);
      setToast(undoable && UNDO_TEXT[to] ? { text: `${o.token} ${UNDO_TEXT[to]}`, undo: { id: o.id, to: from } } : null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { localStorage.removeItem(PIN_KEY); setPin(null); }
      setToast({ text: e instanceof ApiError ? e.message : 'नेट नहीं है, फिर से टैप करें', err: true });
    }
    refresh();
  };

  const list = orders ?? [];
  const rail = list.filter((o) => o.status === 'new' || o.status === 'cooking');
  const ready = list.filter((o) => o.status === 'ready').sort((a, b) => (b.readyAt ?? '').localeCompare(a.readyAt ?? ''));
  const due = list.filter((o) => o.status === 'awaiting_cash');
  const tray = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of rail) for (const l of o.lines) m.set(l.itemId, (m.get(l.itemId) ?? 0) + l.qty);
    return [...m.entries()].sort((a, b) => (itemById(a[0])?.cat ?? '').localeCompare(itemById(b[0])?.cat ?? ''));
  }, [rail]);
  const clock = new Date(now).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });

  return (
    <div className="kitchen">
      <div className="top">
        <div className="logo">Benne <i>14</i></div>
        <button className={`ibtn ${soundOn ? 'on' : 'ask'}`} onClick={() => {
          if (soundOn) { setSoundOn(false); return; }
          audio.current ??= new AudioContext();
          audio.current.resume();
          setSoundOn(true);
          chime(audio.current, [660]);
        }}><Speaker />{soundOn ? 'आवाज़' : 'आवाज़ चालू करें'}</button>
        {!online && <span className="net"><i />नेट नहीं है, जुड़ रहा है…</span>}
        <div className="clock">{clock}</div>
      </div>

      <div className="railwrap">
        <div className="rail" />
        <div className="chits">
          {rail.map((o) => <Chit key={o.id} o={o} now={now} onGo={() => move(o, o.status === 'new' ? 'cooking' : 'ready')} />)}
        </div>
        {orders && rail.length === 0 && <div className="empty"><div><b>अभी कोई ऑर्डर नहीं</b>New orders drop onto this rail with a chime.</div></div>}
      </div>

      <div className="pass">
        {due.length > 0 && <>
          <div className="pass-h due"><Rupee /><b>पैसे लेने हैं</b><span>{due.length}</span></div>
          {due.map((o) => (
            <div className="plate due" key={o.id}>
              <div className="row1"><span className="tok">{o.token}</span>{o.type === 'dine_in' ? <Dine /> : <Bag />}<span className="w amt">₹{o.total}</span></div>
              <div className="nm2">{o.payMethod === 'card' ? 'कार्ड मशीन' : 'नकद'}{o.customerName ? ` · ${o.customerName}` : ''} · {o.itemCount} {o.itemCount === 1 ? 'item' : 'items'}</div>
              <button onClick={() => move(o, 'new', false)}><Check />पैसे मिल गए</button>
            </div>
          ))}
          <div className="gap" />
        </>}
        <div className="pass-h"><Bell /><b>काउंटर पर</b><span>{ready.length}</span></div>
        {ready.map((o) => {
          const w = o.readyAt ? minutesSince(o.readyAt, now) : 0;
          return (
            <div className="plate" key={o.id}>
              <div className="row1"><span className="tok">{o.token}</span>{o.type === 'dine_in' ? <Dine /> : <Bag />}<span className="w"><i className={w >= 3 ? 'long' : ''} />{w}′</span></div>
              <div className="nm2">{o.customerName ? `${o.customerName} · ` : ''}{o.lines.map((l) => `${l.qty} ${l.hi}`).join(', ')}</div>
              <button onClick={() => move(o, 'handed_over')}><Hand />दे दिया</button>
            </div>
          );
        })}
      </div>

      <div className="tray">
        <div className="onfire"><Flame /></div>
        {tray.length === 0 && <span className="quiet">तवा खाली है</span>}
        {tray.map(([id, n]) => {
          const src = photoOf(id);
          return <div className="dish" key={id} title={itemById(id)?.name}>{src ? <img src={src} alt="" /> : <div className="ph">कॉफ़ी</div>}<b>{n}</b></div>;
        })}
        {toast && (
          <div className={`toast ${toast.err ? 'err' : ''}`}>
            {!toast.err && <Check />}{toast.text}
            {toast.undo && <button onClick={() => { const u = toast.undo!; const o = list.find((x) => x.id === u.id); setToast(null); if (o) move({ ...o, status: o.status }, u.to, false); }}><Undo />वापस</button>}
          </div>
        )}
      </div>

      {pinChecked && !pin && <PinGate onPin={(p) => { localStorage.setItem(PIN_KEY, p); setPin(p); }} />}
    </div>
  );
}

function Chit({ o, now, onGo }: { o: Order; now: number; onGo: () => void }) {
  const m = minutesSince(o.paidAt ?? o.createdAt, now);
  const age = m >= LATE_MIN ? 'late' : m >= WARN_MIN ? 'warn' : '';
  return (
    <div className={`chit ${o.status} ${age}`} data-testid={`chit-${o.token}`}>
      <span className="clip" />
      <div className="age"><i style={{ width: `${Math.min(100, (m / 15) * 100)}%` }} /></div>
      <div className="ch-h"><span className="tok">{o.token}</span>{o.type === 'dine_in' ? <Dine /> : <Bag />}<span className="min">{m}′</span></div>
      {o.customerName && <div className="who">{o.customerName}</div>}
      <div className="perf" />
      <div className="items">
        {o.lines.map((l, i) => {
          const extras = l.mods.filter((x) => x.price > 0);
          const spice = l.mods.find((x) => x.groupId === 'spice' && x.id !== 'regular');
          const sugar = l.mods.find((x) => x.groupId === 'sugar' && x.id !== 'regular');
          const hasTags = extras.length || spice || sugar || l.notes.length;
          return (
            <div className="ln" key={i}>
              <span className={`qty ${l.qty === 1 ? 'one' : ''}`}>{l.qty}</span>
              <div>
                <div className="nm">{l.hi}</div>
                {hasTags ? (
                  <div className="tags">
                    {spice && <span className="tg hot">{spice.hi}</span>}
                    {extras.map((x) => <span className="tg add" key={x.id}>{x.hi}</span>)}
                    {sugar && <span className="tg opt">{sugar.hi}</span>}
                    {l.notes.map((n) => <span className="tg note" key={n.id}>{n.hi}</span>)}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <button className="go" onClick={onGo} data-testid={`go-${o.token}`}>
        {o.status === 'new' ? <><Flame />शुरू करो</> : <><Check />तैयार</>}
      </button>
    </div>
  );
}

function PinGate({ onPin }: { onPin: (p: string) => void }) {
  const [v, setV] = useState('');
  const press = (d: string) => setV((cur) => {
    const n = d === '⌫' ? cur.slice(0, -1) : (cur + d).slice(0, 4);
    if (n.length === 4) setTimeout(() => onPin(n), 150);
    return n;
  });
  return (
    <div className="pin">
      <div className="box">
        <h2 className="disp">Kitchen</h2>
        <p>स्टाफ़ PIN डालें</p>
        <div className="dots">{[0, 1, 2, 3].map((i) => <i key={i} className={i < v.length ? 'f' : ''} />)}</div>
        <div className="pad">{['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((d, i) => d ? <button key={i} onClick={() => press(d)}>{d}</button> : <span key={i} />)}</div>
      </div>
    </div>
  );
}
