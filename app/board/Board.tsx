'use client';
import { useEffect, useState } from 'react';
import { itemById, photoOf } from '@/lib/menu';
import { minutesSince } from '@/lib/orders';
import { useLiveOrders } from '@/lib/client';

const PROMOS = ['ghee-podi-thatte-idli', 'ghee-podi-benne-dosa', 'medu-vada'];
const PREP_MAX = 8;

const Bell = () => <svg viewBox="0 0 34 34"><g fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round"><path d="M4 26h26M7 26a10 10 0 0 1 20 0M17 13v3M14 10h6" /></g></svg>;
const Flame = () => <svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-4-1-6 1-9z" /></svg>;

export default function Board() {
  const { orders, online } = useLiveOrders(1500);
  const [now, setNow] = useState(Date.now());
  const [promo, setPromo] = useState(0);
  useEffect(() => {
    const t = setInterval(() => { setNow(Date.now()); setPromo((p) => (p + 1) % PROMOS.length); }, 8000);
    return () => clearInterval(t);
  }, []);

  const list = orders ?? [];
  const ready = list.filter((o) => o.status === 'ready').sort((a, b) => (b.readyAt ?? '').localeCompare(a.readyAt ?? ''));
  const prep = list.filter((o) => o.status === 'new' || o.status === 'cooking');
  const hero = ready[0];
  const p = itemById(PROMOS[promo])!;
  const clock = new Date(now).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });

  return (
    <div className="board">
      <div className="top">
        <div className="logo">Benne <i>14</i><small>AUTHENTIC BANGALORE DOSA</small></div>
        {!online && <span className="net">● reconnecting</span>}
        <div className="clock">{clock}</div>
      </div>

      <section className="ready">
        <div className="zh"><span className="ic"><Bell /></span><b>Ready</b><span className="hi">काउंटर से ले लीजिए</span></div>
        {hero ? (
          <div className="hero">
            {/* key on the token so the pop animation replays for every newly ready order */}
            <div className="tkt pop" key={hero.id} data-testid="board-hero"><div className="num">{hero.token}</div><div className="perf" /><div className="nm">{hero.customerName ?? (hero.type === 'dine_in' ? 'Table order' : 'Takeaway')}</div></div>
            <div className="callout">{hero.customerName ? <><b>{hero.customerName}</b>, आपका </> : 'आपका '}ऑर्डर <b>तैयार</b> है!<small>Please collect from the counter</small></div>
          </div>
        ) : (
          <div className="calm">गरमा-गरम बन रहा है।<small>Ready tokens appear here. Keep an eye on the screen.</small></div>
        )}
        <div className="more">
          {ready.slice(1, 3).map((o) => (
            <div className="tkt" key={o.id}><div className="num">{o.token}</div><div className="perf" /><div className="nm">{o.customerName ?? (o.type === 'dine_in' ? 'Table order' : 'Takeaway')}</div></div>
          ))}
        </div>
      </section>

      <section className="prep">
        <div className="zh"><span className="ic"><Flame /></span><b>On the tawa</b><span className="hi">बन रहा है</span></div>
        <div className="grid">
          {prep.slice(0, prep.length > PREP_MAX ? PREP_MAX - 1 : PREP_MAX).map((o) => {
            const m = minutesSince(o.paidAt ?? o.createdAt, now);
            const n = o.status === 'new' ? 1 : m >= 6 ? 3 : 2;
            return <div className={`pc ${n === 3 ? 'soon' : ''}`} key={o.id} data-testid={`board-prep-${o.token}`}><span className="num">{o.token}</span><span className="dots">{[0, 1, 2].map((i) => <i key={i} className={i < n ? 'f' : ''} />)}</span></div>;
          })}
          {prep.length > PREP_MAX && <div className="pc extra">+{prep.length - PREP_MAX + 1} more</div>}
        </div>
      </section>

      <div className="promo" key={p.id}>
        <img src={photoOf(p.id)} alt="" />
        <div><div className="t">{p.name}</div><div className="hi">{p.desc}</div></div>
        <div className="p"><s>₹{p.mrp}</s><b>₹{p.price}</b></div>
        <div className="dots">{PROMOS.map((id, i) => <i key={id} className={i === promo ? 'on' : ''} />)}</div>
      </div>
    </div>
  );
}
