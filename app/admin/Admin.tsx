'use client';
// Owner dashboard (phone). Design: prototype/admin.html. Behind the staff PIN until the owner gets a login.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PinGate, PIN_KEY } from '@/components/PinGate';
import { admin, api, ApiError, useLiveOrders, usePoll, useTodayOrders, type Report } from '@/lib/client';
import { CATEGORIES, mergeCatalog, photoOf, placeholderOf, type Catalog, type MenuItem } from '@/lib/menu';
import { addDays, isPaid, istDay, type AdminEvent, type Order, type OrderStatus } from '@/lib/orders';
import type { Summary } from '@/lib/reports';

type Tab = 'today' | 'orders' | 'menu' | 'reports' | 'history';
const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const inr2 = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
const dayLabel = (d: string, opts: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'short' }) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-IN', { ...opts, timeZone: 'UTC' });
const hourLabel = (h: number) => (h % 12 || 12) + (h < 12 ? ' am' : ' pm');
const hourTick = (h: number) => String(h % 12 || 12);

export default function Admin() {
  const [pin, setPin] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('today');
  useEffect(() => { setPin(localStorage.getItem(PIN_KEY)); setReady(true); }, []);
  // A PIN the server stops accepting (changed in Vercel) sends the owner back to the PIN pad.
  const onAuthError = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.status === 401) { localStorage.removeItem(PIN_KEY); setNote('The PIN was changed. Enter the new PIN.'); setPin(null); }
  }, []);
  const live = useLiveOrders(5000);
  const toConfirm = (live.orders ?? []).filter((o) => o.status === 'awaiting_cash').length;

  if (!ready) return null;
  if (!pin) return <div className="adm"><PinGate title="Owner" note={note} onPin={(p) => { localStorage.setItem(PIN_KEY, p); setNote(null); setPin(p); }} /></div>;
  const ctx = { pin, onAuthError };
  return (
    <div className="adm">
      {tab === 'today' && <Today {...ctx} live={live.orders ?? []} refreshLive={live.refresh} go={setTab} />}
      {tab === 'orders' && <Orders {...ctx} refreshLive={live.refresh} />}
      {tab === 'menu' && <Menu {...ctx} openHistory={() => setTab('history')} />}
      {tab === 'reports' && <Reports {...ctx} />}
      {tab === 'history' && <History {...ctx} back={() => setTab('menu')} />}
      <nav className="tabs">
        {(['today', 'orders', 'menu', 'reports'] as const).map((t) => (
          <button key={t} className={tab === t || (t === 'menu' && tab === 'history') ? 'on' : ''} onClick={() => setTab(t)} data-testid={`tab-${t}`}>
            {ICONS[t]}{t[0].toUpperCase() + t.slice(1)}
            {t === 'orders' && toConfirm > 0 && <span className="dot">{toConfirm}</span>}
          </button>
        ))}
      </nav>
    </div>
  );
}

interface Ctx { pin: string; onAuthError: (e: unknown) => void }

function Bar({ right }: { right?: React.ReactNode }) {
  return <div className="bar"><div className="logo">Benne <i>14</i></div>{right && <div className="when">{right}</div>}</div>;
}

function useReport({ pin, onAuthError }: Ctx, from: string, to: string, every = 0) {
  const [r, setR] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const range = useRef({ from, to });
  range.current = { from, to }; // an answer for a range the owner has already left is dropped
  // `every` = 0: load once per range (a day keeps the poll asleep); otherwise refresh on that interval.
  const reload = usePoll(async () => {
    try { const x = await admin.report(pin, from, to); if (x.from === range.current.from && x.to === range.current.to) setR(x); setErr(null); }
    catch (e) { onAuthError(e); setErr(e instanceof ApiError ? e.message : 'No internet'); return false; }
  }, every || 24 * 3600_000, true);
  useEffect(() => { setR(null); reload(); }, [from, to, reload]);
  return { r, err };
}

/* ---------------- Today ---------------- */
function Today(p: Ctx & { live: Order[]; refreshLive: () => void; go: (t: Tab) => void }) {
  const today = istDay();
  const { r, err } = useReport(p, today, today, 15_000);
  const s = r?.current, y = r?.previous.summary;
  const due = p.live.filter((o) => o.status === 'awaiting_cash');
  const count = (st: OrderStatus) => p.live.filter((o) => o.status === st).length;
  const [busy, setBusy] = useState<string | null>(null);
  const paid = async (o: Order) => {
    setBusy(o.id);
    try { await api.setStatus(o.id, 'new', p.pin, o.status); } catch (e) { p.onAuthError(e); }
    setBusy(null); p.refreshLive();
  };
  const diff = s && y ? s.takings - y.takings : 0;
  return (
    <section className="screen-today">
      <Bar right={<><b>{dayLabel(today)}</b>Today</>} />
      <div className="slip" data-testid="today-slip">
        <div className="top"><span className="eyebrow">Today&apos;s takings</span><span className="live"><i />Live</span></div>
        <div className="big" data-testid="today-takings">{s ? inr(s.takings) : '…'}</div>
        {s && y && <div className={`vs ${diff < 0 ? 'down' : ''}`}>{diff === 0 ? 'Same as yesterday' : `${diff > 0 ? '▲' : '▼'} ${inr(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} than yesterday`}</div>}
        {err && <div className="vs down">{err}</div>}
        <div className="three">
          <div><b data-testid="today-orders">{s?.orders ?? '–'}</b>orders</div>
          <div><b>{s ? inr(s.avgBill) : '–'}</b>average bill</div>
          <div><b>{s ? inr(s.refunds.amount) : '–'}</b>refunds</div>
        </div>
        {s && <Split s={s} />}
      </div>

      {due.length > 0 && (
        <div className="sec">
          <div className="sec-h"><h2>Needs you</h2><button className="link" onClick={() => p.go('orders')}>All orders →</button></div>
          {due.map((o) => (
            <div className="need" key={o.id} data-testid={`need-${o.token}`}>
              <span className="tok">{o.token}</span>
              <div className="what"><b>{o.payMethod === 'upi' ? 'UPI' : o.payMethod === 'card' ? 'Card' : 'Cash'} {inr(o.total)} · {o.payMethod === 'upi' ? 'says paid' : 'at counter'}</b>
                {o.payMethod === 'upi' ? 'Check the soundbox' : `${o.itemCount} ${o.itemCount === 1 ? 'item' : 'items'}`}{o.customerName ? ` · ${o.customerName}` : ''} · {time(o.createdAt)}</div>
              <button onClick={() => paid(o)} disabled={busy === o.id}>Paid</button>
            </div>
          ))}
        </div>
      )}

      <div className="sec">
        <div className="sec-h"><h2>Kitchen now</h2></div>
        <div className="kitchen-now"><div><b>{count('new')}</b>waiting</div><div><b>{count('cooking')}</b>on the tawa</div><div><b>{count('ready')}</b>ready</div></div>
      </div>

      <div className="sec">
        <div className="sec-h"><h2>Selling today</h2><button className="link" onClick={() => p.go('reports')}>Reports →</button></div>
        {s && s.dishes.length === 0 && <div className="none">No orders yet today.</div>}
        {s?.dishes.slice(0, 5).map((d) => <DishRow key={d.itemId} d={d} max={s.dishes[0].qty} />)}
      </div>

      {s && (
        <div className="sec">
          <div className="sec-h"><h2>Busy hours</h2></div>
          <Hours s={s} days={1} />
        </div>
      )}
    </section>
  );
}

function Split({ s }: { s: Summary }) {
  const t = s.split.upi + s.split.card + s.split.cash;
  const parts = [['UPI', s.split.upi, 'var(--cream)'], ['Card', s.split.card, 'var(--benne)'], ['Cash', s.split.cash, 'var(--s3)']] as const;
  return (
    <div className="split">
      <div className="track">{t > 0 ? parts.map(([k, v, c]) => <i key={k} style={{ flex: v, background: c }} />) : <i style={{ flex: 1, background: 'var(--s2)' }} />}</div>
      <div className="legend">{parts.map(([k, v, c]) => <div key={k} style={{ '--c': c } as React.CSSProperties}><span>{k}</span><b>{inr(v)}</b></div>)}</div>
    </div>
  );
}

function DishRow({ d, max }: { d: Summary['dishes'][number]; max: number }) {
  const src = photoOf(d.itemId);
  return (
    <div className="dish">
      {src ? <img src={src} alt="" /> : <div className="ph">{placeholderOf(d.itemId)}</div>}
      <div><b>{d.name}</b><small>{inr(d.amount)}</small><div className="meter"><i style={{ width: `${max ? (d.qty / max) * 100 : 0}%` }} /></div></div>
      <div className="r"><b>{d.qty}</b><small>sold</small></div>
    </div>
  );
}

function Hours({ s, days }: { s: Summary; days: number }) {
  const vals = s.hours.map((h) => h.orders / days);
  const max = Math.max(...vals, 0);
  const peak = max > 0 ? s.hours[vals.indexOf(max)] : null;
  const fmt = (v: number) => (days > 1 ? v.toFixed(v < 10 ? 1 : 0) : String(v));
  return (
    <div className="hours" data-testid="hours">
      <div className="bars">{s.hours.map((h, i) => <i key={h.hour} className={peak && h.hour === peak.hour ? 'peak' : ''} style={{ height: `${max ? (vals[i] / max) * 100 : 0}%` }}>{peak && h.hour === peak.hour && <b>{fmt(vals[i])}</b>}</i>)}</div>
      <div className="axis">{s.hours.map((h) => <span key={h.hour}>{hourTick(h.hour)}</span>)}</div>
      <div className="note">{peak ? <>{days > 1 ? 'Average orders per hour. ' : ''}Busiest: <b>{hourLabel(peak.hour)}–{hourLabel(peak.hour + 1)}</b>{days > 1 ? '' : `, ${peak.orders} orders`}.</> : 'No orders yet.'}</div>
    </div>
  );
}

/* ---------------- Orders ---------------- */
const STATUS: Record<OrderStatus, [string, string]> = {
  pending_payment: ['QR open', 'due'], awaiting_cash: ['To confirm', 'due'], new: ['Waiting', 'cooking'], cooking: ['On the tawa', 'cooking'],
  ready: ['Ready', 'ready'], handed_over: ['Collected', 'done'], cancelled: ['Cancelled', 'done'],
};
const PAY = { upi: 'UPI', card: 'Card', cash: 'Cash' } as const;

function Orders(p: Ctx & { refreshLive: () => void }) {
  const all = useTodayOrders(true, 5000) ?? [];
  const [fresh, setFresh] = useState<Record<string, Order>>({}); // results of this screen's own actions, until the next poll
  const list = all.map((o) => (fresh[o.id] && fresh[o.id].updatedAt >= o.updatedAt ? fresh[o.id] : o));
  const [filter, setFilter] = useState<'all' | 'confirm' | 'cancelled'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const confirmN = list.filter((o) => o.status === 'awaiting_cash').length;
  const shown = list.filter((o) => filter === 'all' || (filter === 'confirm' ? o.status === 'awaiting_cash' : o.status === 'cancelled' || !!o.refundedAt));
  const counted = list.filter((o) => isPaid(o) && !o.refundedAt);
  const sel = list.find((o) => o.id === open) ?? null;
  return (
    <section>
      <Bar right={<><b>Today</b>{counted.length} paid orders</>} />
      <div className="h1">Orders</div>
      <div className="filters">
        <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All</button>
        <button className={filter === 'confirm' ? 'on' : ''} onClick={() => setFilter('confirm')} data-testid="filter-confirm">To confirm{confirmN > 0 && <em>{confirmN}</em>}</button>
        <button className={filter === 'cancelled' ? 'on' : ''} onClick={() => setFilter('cancelled')}>Cancelled</button>
      </div>
      <div className="olist">
        {shown.length === 0 && <div className="none">Nothing here.</div>}
        {shown.map((o) => {
          const [label, cls] = o.refundedAt ? ['Refunded', 'refund'] : STATUS[o.status];
          return (
            <button className={`ord ${o.refundedAt || o.status === 'cancelled' ? 'void' : ''}`} key={o.id} onClick={() => setOpen(o.id)} data-testid={`ord-${o.token}`}>
              <span className="tok">{o.token}</span>
              <div className="mid"><div className="l1"><b>{time(o.createdAt)}</b>{o.type === 'dine_in' ? 'Dine-in' : 'Takeaway'}{o.customerName ? ` · ${o.customerName}` : ''}</div>
                <div className="l2">{o.lines.map((l) => `${l.qty} × ${l.name}`).join(', ')}{o.refundReason ? ` · ${o.refundReason}` : ''}</div></div>
              <div className="amt"><b>{inr(o.total)}</b><span className={`st ${cls}`}>{label}{o.status === 'handed_over' && !o.refundedAt ? ` · ${PAY[o.payMethod]}` : ''}</span></div>
            </button>
          );
        })}
      </div>
      {sel && <OrderSheet {...p} o={sel} close={() => setOpen(null)} changed={(o) => { setFresh((f) => ({ ...f, [o.id]: o })); p.refreshLive(); }} />}
    </section>
  );
}

const REASONS = ['Wrong order', 'Customer left', 'Food issue', 'Paid twice'];

function OrderSheet(p: Ctx & { o: Order; close: () => void; changed: (o: Order) => void }) {
  const { o } = p;
  const [refunding, setRefunding] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [other, setOther] = useState('');
  const [sure, setSure] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (f: () => Promise<Order>) => {
    setBusy(true); setErr(null);
    try { p.changed(await f()); setRefunding(false); setSure(false); } catch (e) { p.onAuthError(e); setErr(e instanceof ApiError ? e.message : 'No internet. Try again.'); }
    setBusy(false);
  };
  const unpaid = o.status === 'awaiting_cash' || o.status === 'pending_payment';
  const why = reason === 'Other' ? other.trim() : reason;
  const [label] = o.refundedAt ? ['Refunded'] : STATUS[o.status];
  return (
    <>
      <div className="scrim" onClick={p.close} />
      <div className="sheet" data-testid="order-sheet">
        <div className="grab" />
        <div className="hd"><span className="tok">{o.token}</span>
          <div className="meta"><b>{o.type === 'dine_in' ? 'Dine-in' : 'Takeaway'}{o.customerName ? ` · ${o.customerName}` : ''}</b><br />Today {time(o.createdAt)} · {PAY[o.payMethod]}<br /><span className="state">{label}</span></div></div>
        <div className="bill">
          {o.lines.map((l, i) => {
            const extras = l.mods.filter((m) => m.price > 0).map((m) => `+ ${m.name} (₹${m.price})`);
            const rest = [...l.mods.filter((m) => !m.price && m.id !== 'regular').map((m) => m.name), ...l.notes.map((n) => n.label)];
            return <div className="li" key={i}><div>{l.qty} × {l.name}{(extras.length > 0 || rest.length > 0) && <small>{[...extras, ...rest].join(' · ')}</small>}</div><b>{inr2(l.lineTotal)}</b></div>;
          })}
          <div className="row"><span>Subtotal</span><span>{inr2(o.subtotal)}</span></div>
          <div className="row"><span>CGST 2.5% + SGST 2.5%</span><span>{inr2(o.cgst + o.sgst)}</span></div>
          <div className="tot"><span>Total</span><b>{inr2(o.total)}</b></div>
        </div>
        <div className="timeline">
          <div><time>{time(o.createdAt)}</time>Ordered at the kiosk</div>
          {o.paidAt && <div><time>{time(o.paidAt)}</time>Payment confirmed</div>}
          {o.readyAt && <div><time>{time(o.readyAt)}</time>Ready at the counter</div>}
          {o.refundedAt && <div><time>{time(o.refundedAt)}</time>Refunded {inr(o.refundAmount ?? o.total)} · {o.refundReason}</div>}
        </div>
        {err && <div className="err">{err}</div>}
        <div className="actions">
          {unpaid && <button className="btn y" disabled={busy} onClick={() => act(() => api.setStatus(o.id, 'new', p.pin, o.status))} data-testid="sheet-paid">Paid</button>}
          {unpaid && <button className="btn r" disabled={busy} onClick={() => (sure ? act(() => api.setStatus(o.id, 'cancelled', p.pin, o.status)) : setSure(true))} data-testid="sheet-cancel">{sure ? 'Yes, cancel this order' : 'Cancel order'}</button>}
          {isPaid(o) && !o.refundedAt && !refunding && <button className="btn r" onClick={() => setRefunding(true)} data-testid="sheet-refund">Refund this order…</button>}
        </div>
        {refunding && (
          <div className="reason">
            <p><b>Refund {inr(o.total)}{o.customerName ? ` to ${o.customerName}` : ''}?</b> Give the money back from the Paytm app or the cash drawer first. This only records it, so the takings stay right.</p>
            <div className="opts">{[...REASONS, 'Other'].map((r) => <button key={r} className={reason === r ? 'on' : ''} onClick={() => setReason(r)}>{r === 'Other' ? 'Other…' : r}</button>)}</div>
            {reason === 'Other' && <input className="in" value={other} maxLength={80} onChange={(e) => setOther(e.target.value)} placeholder="What happened?" aria-label="Refund reason" />}
            <button className="btn y" style={{ width: '100%', marginTop: 10 }} disabled={busy || !why} onClick={() => act(() => admin.refund(p.pin, o.id, why!))} data-testid="sheet-record-refund">Record refund</button>
          </div>
        )}
        <div className="actions"><button className="btn o" onClick={() => (refunding ? setRefunding(false) : p.close())}>{refunding ? 'Don’t refund' : 'Close'}</button></div>
      </div>
    </>
  );
}

/* ---------------- Menu ---------------- */
function Menu(p: Ctx & { openHistory: () => void }) {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const load = useCallback(() => api.menu().then((o) => setCat(mergeCatalog(o))).catch(() => setErr('Could not load the menu. Check the internet.')), []);
  useEffect(() => { load(); }, [load]);
  const toggle = async (i: MenuItem) => {
    setCat((c) => c && { ...c, items: c.items.map((x) => (x.id === i.id ? { ...x, soldOut: !i.soldOut } : x)) });
    try { await admin.saveItem(p.pin, { itemId: i.id, soldOut: !i.soldOut }); } catch (e) { p.onAuthError(e); setErr(e instanceof ApiError ? e.message : 'Not saved: no internet.'); }
    load();
  };
  const items = (cat?.items ?? []).filter((i) => !i.testOnly);
  const sel = items.find((i) => i.id === edit);
  return (
    <section>
      <Bar right={<><b>Menu</b>On the kiosk now</>} />
      <div className="h1">Menu</div>
      <div className="hint">Switch a dish off when it runs out. It comes back on by itself tomorrow morning. Tap a dish to change its price, name or description. The kiosk shows changes from the next customer.</div>
      {err && <div className="err pad">{err}</div>}
      {CATEGORIES.filter((c) => items.some((i) => i.cat === c.id)).map((c) => (
        <div className="mcat" key={c.id}><h3>{c.name}</h3>
          {items.filter((i) => i.cat === c.id).map((i) => {
            const src = photoOf(i.id);
            return (
              <div className={`mi ${i.soldOut ? 'off' : ''}`} key={i.id} data-testid={`mi-${i.id}`}>
                <button className="open" onClick={() => setEdit(i.id)}>
                  {src ? <img src={src} alt="" /> : <div className="ph">{placeholderOf(i.id)}</div>}
                  <div><b>{i.name}{i.soldOut && <span className="so">Sold out</span>}</b><span className="p">₹{i.price}</span></div>
                </button>
                <button className={`sw ${i.soldOut ? 'off' : ''}`} role="switch" aria-checked={!i.soldOut} aria-label={`${i.name} on the kiosk`} onClick={() => toggle(i)} data-testid={`sw-${i.id}`}><span className="swlbl">{i.soldOut ? 'Off' : 'On'}</span></button>
              </div>
            );
          })}
        </div>
      ))}
      <button className="histlink" onClick={p.openHistory} data-testid="open-history">Change history →</button>
      {sel && cat && <EditSheet {...p} item={sel} cat={cat} close={() => setEdit(null)} saved={() => { setEdit(null); load(); }} />}
    </section>
  );
}

function EditSheet(p: Ctx & { item: MenuItem; cat: Catalog; close: () => void; saved: () => void }) {
  const { item, cat } = p;
  const [price, setPrice] = useState(String(item.price));
  const [name, setName] = useState(item.name);
  const [desc, setDesc] = useState(item.desc);
  const extras = item.groups.map((g) => cat.groups[g]).filter((g) => g.kind === 'many');
  const [ex, setEx] = useState<Record<string, string>>(() => Object.fromEntries(extras.flatMap((g) => g.options.map((o) => [`${g.id}:${o.id}`, String(o.price)]))));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const n = Number(price);
  const priceOk = /^\d+$/.test(price) && n >= 1 && n <= 100000;
  const withGst = priceOk ? n + Math.round(n * 0.05) : null;
  const save = async () => {
    if (!priceOk) { setErr('Price must be a whole number of rupees'); return; }
    if (!name.trim()) { setErr('The name can’t be empty'); return; }
    setBusy(true); setErr(null);
    try {
      const patch: Parameters<typeof admin.saveItem>[1] = { itemId: item.id };
      if (n !== item.price) patch.price = n;
      if (name.trim() !== item.name) patch.name = name.trim();
      if (desc.trim() !== item.desc) patch.desc = desc.trim() || null;
      const options: { groupId: string; optionId: string; price: number }[] = [];
      for (const g of extras) for (const o of g.options) {
        const v = ex[`${g.id}:${o.id}`];
        if (v === String(o.price)) continue;
        if (!/^\d+$/.test(v) || Number(v) > 100000) throw new ApiError(`${o.name}: price must be a whole number of rupees`, 400);
        options.push({ groupId: g.id, optionId: o.id, price: Number(v) });
      }
      if (options.length) patch.options = options;
      if (Object.keys(patch).length > 1) await admin.saveItem(p.pin, patch); // one request: all of it or none
      p.saved();
    } catch (e) { p.onAuthError(e); setErr(e instanceof ApiError ? e.message : 'Not saved: no internet.'); setBusy(false); }
  };
  return (
    <>
      <div className="scrim" onClick={p.close} />
      <div className="sheet" data-testid="edit-sheet">
        <div className="grab" />
        <div className="hd"><div><span className="eyebrow">Edit dish</span><div className="disp ttl">{item.name}</div></div></div>
        <div className="field"><label htmlFor="ed-price">Price</label>
          <div className="money"><span>₹</span><input id="ed-price" className="in" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, '').slice(0, 6))} data-testid="ed-price" /></div>
          <div className="was">{n !== item.price && priceOk ? `Was ₹${item.price} · ` : ''}{withGst ? `customers pay about ₹${withGst} with GST` : 'Enter a price'}</div></div>
        <div className="field"><label htmlFor="ed-name">Name on the kiosk</label><input id="ed-name" className="in" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} data-testid="ed-name" /></div>
        <div className="field"><label htmlFor="ed-desc">Description</label><textarea id="ed-desc" className="in ta" value={desc} maxLength={160} onChange={(e) => setDesc(e.target.value)} data-testid="ed-desc" />
          <div className="was">Shown under the name on the kiosk. One or two short lines. {desc.length}/160</div></div>
        {extras.map((g) => (
          <div className="field extras" key={g.id}><label>Extras (same price on every dish that has them)</label>
            {g.options.map((o) => <div className="x" key={o.id}><span>{o.name}</span><span className="money sm"><span>₹</span><input className="in" inputMode="numeric" aria-label={`${o.name} price`} value={ex[`${g.id}:${o.id}`]} onChange={(e) => setEx({ ...ex, [`${g.id}:${o.id}`]: e.target.value.replace(/[^\d]/g, '').slice(0, 6) })} /></span></div>)}
          </div>
        ))}
        {err && <div className="err">{err}</div>}
        <div className="actions"><button className="btn y" onClick={save} disabled={busy} data-testid="ed-save">{busy ? 'Saving…' : 'Save'}</button><button className="btn o" onClick={p.close}>Cancel</button></div>
      </div>
    </>
  );
}

/* ---------------- Reports ---------------- */
type Range = 'day' | 'week' | 'month' | 'custom';
function rangeFor(kind: Range, anchor: string, custom: { from: string; to: string }) {
  if (kind === 'day') return { from: anchor, to: anchor };
  if (kind === 'week') return { from: addDays(anchor, -6), to: anchor };
  if (kind === 'month') {
    const first = anchor.slice(0, 8) + '01';
    const next = new Date(Date.parse(first + 'T00:00:00Z')); next.setUTCMonth(next.getUTCMonth() + 1);
    return { from: first, to: addDays(next.toISOString().slice(0, 10), -1) };
  }
  return custom;
}
function stepAnchor(kind: Range, anchor: string, dir: 1 | -1) {
  if (kind === 'day') return addDays(anchor, dir);
  if (kind === 'week') return addDays(anchor, 7 * dir);
  const d = new Date(Date.parse(anchor.slice(0, 8) + '01T00:00:00Z')); d.setUTCMonth(d.getUTCMonth() + dir);
  return d.toISOString().slice(0, 10);
}
const pct = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 100) : null);

function Reports(p: Ctx) {
  const today = istDay();
  const [kind, setKind] = useState<Range>('week');
  const [anchor, setAnchor] = useState(today);
  const [custom, setCustom] = useState({ from: addDays(today, -29), to: today });
  const { from, to } = useMemo(() => rangeFor(kind, anchor, custom), [kind, anchor, custom]);
  const { r, err } = useReport(p, from, to);
  const [allDishes, setAllDishes] = useState(false);
  const [dl, setDl] = useState<string | null>(null);
  const s = r?.current, y = r?.previous.summary;
  const days = r ? r.current.days.length : 1;
  const label = from === to ? dayLabel(from, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : `${dayLabel(from, { day: 'numeric', month: 'short' })} – ${dayLabel(to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const download = async (k: 'bills' | 'gst' | 'dishes') => {
    setDl(null);
    try { await admin.download(p.pin, k, from, to); } catch (e) { p.onAuthError(e); setDl(e instanceof ApiError ? e.message : 'No internet. Try again.'); }
  };
  const kpi = (name: string, val: string, now: number, before: number | undefined, money = false) => {
    const d = before === undefined ? null : pct(now, before);
    return (
      <div className="kpi"><span className="eyebrow">{name}</span><b>{val}</b>
        {before !== undefined && <small className={now < before ? 'down' : ''}>{d === null ? (now ? 'new' : '—') : `${d >= 0 ? '▲' : '▼'} ${Math.abs(d)}%`} vs {kind === 'day' ? 'day before' : 'before'}{money ? '' : ''}</small>}</div>
    );
  };
  const maxDay = Math.max(...(s?.days.map((d) => d.takings) ?? [0]), 0);
  return (
    <section>
      <Bar />
      <div className="h1">Reports</div>
      <div className="range">{(['day', 'week', 'month', 'custom'] as const).map((k) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => { setKind(k); setAnchor(today); }} data-testid={`range-${k}`}>{k[0].toUpperCase() + k.slice(1)}</button>)}</div>
      {kind === 'custom'
        ? <div className="custom"><input type="date" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })} aria-label="From" /><span>to</span><input type="date" value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })} aria-label="To" /></div>
        : <div className="period"><button onClick={() => setAnchor(stepAnchor(kind, anchor, -1))} aria-label="Earlier">‹</button><span data-testid="period">{label}</span><button onClick={() => setAnchor(stepAnchor(kind, anchor, 1))} disabled={to >= today} aria-label="Later">›</button></div>}
      {err && <div className="err pad">{err}</div>}
      {!s && !err && <div className="none pad">Loading…</div>}
      {s && y && <>
        <div className="kpis">
          {kpi('Takings', inr(s.takings), s.takings, y.takings, true)}
          {kpi('Orders', String(s.orders), s.orders, y.orders)}
          {kpi('Average bill', inr(s.avgBill), s.avgBill, y.avgBill, true)}
          <div className="kpi"><span className="eyebrow">Refunds</span><b>{inr(s.refunds.amount)}</b><small className={s.refunds.count ? 'down' : ''}>{s.refunds.count} {s.refunds.count === 1 ? 'order' : 'orders'}</small></div>
        </div>
        <div className="sec"><Split s={s} /></div>
        {days > 1 && days <= 31 && (
          <div className="sec days"><div className="sec-h"><h2>By day</h2></div>
            <div className="bars">{s.days.map((d) => <i key={d.day} title={`${d.day}: ${inr(d.takings)}`} className={d.takings === maxDay && maxDay > 0 ? 'hi' : ''} style={{ height: `${maxDay ? (d.takings / maxDay) * 100 : 0}%` }} />)}</div>
            <div className="axis">{s.days.map((d, i) => <span key={d.day}>{days <= 7 ? dayLabel(d.day, { weekday: 'short' }) : i % 5 === 0 ? d.day.slice(8) : ''}</span>)}</div>
          </div>
        )}
        <div className="sec">
          <div className="sec-h"><h2>Dishes</h2>{s.dishes.length > 5 && <button className="link" onClick={() => setAllDishes(!allDishes)}>{allDishes ? 'Top 5' : `All ${s.dishes.length} →`}</button>}</div>
          {s.dishes.length === 0 ? <div className="none">No orders in this period.</div> : (
            <table className="tbl" data-testid="dishes">
              <thead><tr><th>Dish</th><th>Sold</th><th>Amount</th></tr></thead>
              <tbody>
                {(allDishes ? s.dishes : s.dishes.slice(0, 5)).map((d) => <tr key={d.itemId}><td>{d.name}</td><td>{d.qty}</td><td>{inr(d.amount)}</td></tr>)}
                {s.extras.qty > 0 && <tr className="sub"><td>Extras</td><td>{s.extras.qty}</td><td>{inr(s.extras.amount)}</td></tr>}
              </tbody>
            </table>
          )}
          <div className="was">Amounts before GST.</div>
        </div>
        <div className="sec"><div className="sec-h"><h2>Busy hours</h2></div><Hours s={s} days={days} /></div>
        <div className="sec">
          <div className="sec-h"><h2>GST for the CA</h2></div>
          <div className="gst" data-testid="gst">
            <div className="row"><span>Taxable value</span><b>{inr2(s.gst.taxable)}</b></div>
            <div className="row"><span>CGST @ 2.5%</span><b>{inr2(s.gst.cgst)}</b></div>
            <div className="row"><span>SGST @ 2.5%</span><b>{inr2(s.gst.sgst)}</b></div>
            <div className="row"><span>Total billed</span><b>{inr2(s.gst.total)}</b></div>
          </div>
          <div className="was">Paid orders only. Refunded and cancelled orders are left out.</div>
        </div>
        <div className="dl">
          {([['bills', 'Every bill', `${s.orders + s.refunds.count} rows`], ['gst', 'GST by day', `${days} rows`], ['dishes', 'Dish-wise sales', `${s.dishes.length + (s.extras.qty ? 1 : 0)} rows`]] as const).map(([k, t, n]) => (
            <button key={k} onClick={() => download(k)} data-testid={`dl-${k}`}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" /></svg>{t} (CSV)<small>{n}</small></button>
          ))}
          {dl && <div className="err">{dl}</div>}
        </div>
      </>}
    </section>
  );
}

/* ---------------- History ---------------- */
function History(p: Ctx & { back: () => void }) {
  const [ev, setEv] = useState<AdminEvent[] | null>(null);
  useEffect(() => { admin.events(p.pin).then(setEv).catch(p.onAuthError); }, [p.pin, p.onAuthError]);
  const groups = new Map<string, AdminEvent[]>();
  for (const e of ev ?? []) { const d = istDay(new Date(e.at)); groups.set(d, [...(groups.get(d) ?? []), e]); }
  const today = istDay();
  const text = (e: AdminEvent) => {
    switch (e.kind) {
      case 'price': case 'option_price': return <><b>{e.subject}</b> price <span className="chg"><s>{e.before}</s> → {e.after}</span></>;
      case 'name': return <>Renamed <b>{e.before}</b> to <b>{e.after}</b></>;
      case 'desc': return <><b>{e.subject}</b> description changed<small>“{e.after}”</small></>;
      case 'sold_out': return <><b>{e.subject}</b> switched off<small>Sold out · back on tomorrow</small></>;
      case 'back_on': return <><b>{e.subject}</b> switched back on</>;
      case 'refund': return <>Refunded <b>{e.subject.toLowerCase()}</b> · {e.after}<small>{e.note}</small></>;
    }
  };
  return (
    <section>
      <Bar right={<><b>Change history</b>Menu &amp; refunds</>} />
      <div className="h1"><button className="hback" onClick={p.back} aria-label="Back to menu">←</button>History</div>
      <div className="log" data-testid="history">
        {ev && ev.length === 0 && <div className="none">No changes yet.</div>}
        {[...groups.entries()].map(([d, list]) => (
          <div key={d}>
            <div className="day">{d === today ? 'Today' : d === addDays(today, -1) ? 'Yesterday' : dayLabel(d)}</div>
            {list.map((e, i) => <div className="e" key={i}><time>{time(e.at)}</time><div>{text(e)}</div></div>)}
          </div>
        ))}
      </div>
    </section>
  );
}

const ICONS: Record<'today' | 'orders' | 'menu' | 'reports', React.ReactNode> = {
  today: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 4h14v16l-2.3-1.5L14.3 20 12 18.5 9.7 20l-2.4-1.5L5 20z" /><path d="M9 9h6M9 13h4" /></svg>,
  orders: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 6h12M8 12h12M8 18h12" /><circle cx="4" cy="6" r="1" fill="currentColor" /><circle cx="4" cy="12" r="1" fill="currentColor" /><circle cx="4" cy="18" r="1" fill="currentColor" /></svg>,
  menu: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="13" r="7" /><circle cx="12" cy="13" r="3.5" /><path d="M12 3v3" /></svg>,
  reports: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 20V11M10 20V5M15 20v-7M20 20V9" /></svg>,
};
