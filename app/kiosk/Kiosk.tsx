'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CART_UPSELL, CATEGORIES, GROUPS, ITEMS, NOTES, PAIRING, itemById, photoOf, type MenuItem } from '@/lib/menu';
import { priceLine, priceOrder, type CartLine } from '@/lib/pricing';
import type { Order, OrderType, PayMethod } from '@/lib/orders';
import { api, ApiError, newKey, useOrder } from '@/lib/client';

type Screen = 'home' | 'menu' | 'cart' | 'pay' | 'upi' | 'done';
type Lang = 'en' | 'hi';
interface Line extends CartLine { uid: string }

const IDLE_MS = 75_000; // "Still there?" after this long without a touch
const IDLE_GRACE_S = 15;
const DONE_RESET_S = 20;

const sameChoices = (a: CartLine, b: CartLine) =>
  a.itemId === b.itemId && JSON.stringify(a.choices) === JSON.stringify(b.choices) && JSON.stringify([...a.notes].sort()) === JSON.stringify([...b.notes].sort());

function Photo({ item, big }: { item: MenuItem; big?: boolean }) {
  const src = photoOf(item.id);
  return src ? <img src={src} alt="" /> : <div className="nophoto" style={big ? { fontSize: 80 } : undefined}>कॉफ़ी</div>;
}

export default function Kiosk() {
  const [screen, setScreen] = useState<Screen>('home');
  const [lang, setLang] = useState<Lang>('en');
  const [type, setType] = useState<OrderType>('takeaway');
  const [lines, setLines] = useState<Line[]>([]);
  const [sheet, setSheet] = useState<{ itemId: string; editing?: string } | null>(null);
  const [name, setName] = useState('');
  const [orderId, setOrderId] = useState<string | null>(null);
  const [placed, setPlaced] = useState<Order | null>(null);
  const [idle, setIdle] = useState(false);
  const checkoutKey = useRef(newKey());

  const reset = useCallback(() => {
    setScreen('home'); setLines([]); setSheet(null); setName(''); setOrderId(null); setPlaced(null); setIdle(false); setLang('en');
    checkoutKey.current = newKey();
  }, []);

  // Idle watch: any touch resets the timer; on non-home screens ask "Still there?" before clearing.
  const lastTouch = useRef(Date.now());
  useEffect(() => {
    const touch = () => { lastTouch.current = Date.now(); };
    window.addEventListener('pointerdown', touch);
    const t = setInterval(() => {
      if (screen !== 'home' && screen !== 'done' && screen !== 'upi' && !idle && Date.now() - lastTouch.current > IDLE_MS) setIdle(true);
    }, 1000);
    return () => { window.removeEventListener('pointerdown', touch); clearInterval(t); };
  }, [screen, idle]);

  const priced = useMemo(() => (lines.length ? priceOrder(lines) : null), [lines]);
  const count = priced?.itemCount ?? 0;

  const addLine = (l: CartLine) => setLines((cur) => {
    const same = cur.find((x) => sameChoices(x, l));
    return same ? cur.map((x) => (x === same ? { ...x, qty: Math.min(20, x.qty + l.qty) } : x)) : [...cur, { ...l, uid: newKey() }];
  });
  const quickAdd = (itemId: string) => addLine({ itemId, qty: 1, choices: {}, notes: [] });
  const setQty = (uid: string, qty: number) => setLines((cur) => (qty <= 0 ? cur.filter((l) => l.uid !== uid) : cur.map((l) => (l.uid === uid ? { ...l, qty: Math.min(20, qty) } : l))));
  const qtyOf = (itemId: string) => lines.filter((l) => l.itemId === itemId).reduce((a, l) => a + l.qty, 0);

  return (
    <div className="kiosk">
      {screen === 'home' && <Home lang={lang} setLang={setLang} onPick={(t) => { setType(t); setScreen('menu'); }} />}
      {screen === 'menu' && (
        <MenuScreen lang={lang} setLang={setLang} type={type} onType={() => setScreen('home')} qtyOf={qtyOf}
          onOpen={(id) => setSheet({ itemId: id })} onQuick={quickAdd}
          lines={lines} setQty={setQty} count={count} total={priced?.total ?? 0} onCart={() => setScreen('cart')} />
      )}
      {screen === 'cart' && priced && (
        <Cart lines={lines} type={type} setType={setType} name={name} setName={setName} priced={priced}
          setQty={setQty} onEdit={(uid) => { const l = lines.find((x) => x.uid === uid)!; setSheet({ itemId: l.itemId, editing: uid }); }}
          onAdd={quickAdd} onBack={() => setScreen('menu')} onPay={() => setScreen('pay')} />
      )}
      {screen === 'cart' && !priced && <EmptyRedirect go={() => setScreen('menu')} />}
      {screen === 'pay' && priced && (
        <Pay priced={priced} lines={lines} type={type} name={name} onBack={() => setScreen('cart')}
          onChoose={async (m: PayMethod) => {
            const o = await api.placeOrder({ key: checkoutKey.current, type, name: name.trim() || null, payMethod: m, lines: lines.map(({ uid: _u, ...l }) => l) });
            setOrderId(o.id); setPlaced(o);
            setScreen(m === 'upi' ? 'upi' : 'done');
          }} />
      )}
      {screen === 'upi' && placed && (
        <Upi order={placed} onPaid={() => setScreen('done')} onOther={() => { checkoutKey.current = newKey(); setOrderId(null); setPlaced(null); setScreen('pay'); }} onCancel={reset} />
      )}
      {screen === 'done' && orderId && <Done orderId={orderId} first={placed} onDone={reset} />}

      {sheet && (
        <ItemSheet key={sheet.itemId + (sheet.editing ?? '')} itemId={sheet.itemId} editing={lines.find((l) => l.uid === sheet.editing)}
          pairingInCart={qtyOf(PAIRING) > 0}
          onClose={() => setSheet(null)}
          onAdd={(l, withPairing) => {
            if (sheet.editing) setLines((cur) => cur.map((x) => (x.uid === sheet.editing ? { ...l, uid: x.uid } : x)));
            else addLine(l);
            if (withPairing) quickAdd(PAIRING);
            setSheet(null);
          }} />
      )}
      {idle && <Idle onStay={() => { lastTouch.current = Date.now(); setIdle(false); }} onReset={reset} />}
    </div>
  );
}

function EmptyRedirect({ go }: { go: () => void }) {
  useEffect(() => { go(); }, [go]);
  return null;
}

/* ---------------- Home ---------------- */
const DineIcon = () => (
  <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><circle cx="32" cy="34" r="20" /><circle cx="32" cy="34" r="12" /><path d="M6 12v14m0 0c0 3 4 3 4 0V12m-2 14v28M58 12c-4 4-4 14 0 16v26" /></svg>
);
const BagIcon = () => (
  <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round"><path d="M12 22h40l-3 34H15z" /><path d="M23 22v-4a9 9 0 0 1 18 0v4" /><path d="M26 38c4 4 8 4 12 0" /></svg>
);

function LangToggle({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <div className="lang">
      <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>English</button>
      <button className={`hi ${lang === 'hi' ? 'on' : ''}`} onClick={() => setLang('hi')}>हिंदी</button>
    </div>
  );
}

function Home({ lang, setLang, onPick }: { lang: Lang; setLang: (l: Lang) => void; onPick: (t: OrderType) => void }) {
  const cols = [['masala-dosa', 'medu-vada', 'thatte-idli'], ['mallige-idli', 'ghee-podi-benne-dosa', 'masala-tea'], ['plain-benne-dosa', 'ghee-podi-thatte-idli', 'plain-dosa']];
  return (
    <div className="screen k-home">
      <div className="top">
        <div className="logo">Benne <i>14</i><small>AUTHENTIC BANGALORE DOSA</small></div>
        <LangToggle lang={lang} setLang={setLang} />
      </div>
      <div className="mosaic">
        {cols.map((c, i) => <div className="col" key={i}>{c.map((id) => <img key={id} src={photoOf(id)} alt="" />)}</div>)}
        <div className="badge"><div><b>14%</b><small>Launch<br />week off</small></div></div>
      </div>
      <div className="copy">
        <h1 className="disp">Fresh off<br />the <em>tawa.</em></h1>
        <div className="hi">गरमा-गरम, सीधे तवे से आपकी प्लेट तक।</div>
      </div>
      <div className="choose">
        <button className="choice dine" onClick={() => onPick('dine_in')} data-testid="dine-in">
          <DineIcon /><span className="arr">→</span>
          <div><b>{lang === 'hi' ? 'यहीं खाएँगे' : 'Dine in'}</b><div className="hi">{lang === 'hi' ? 'Dine in' : 'यहीं बैठकर खाएँगे'}</div></div>
        </button>
        <button className="choice take" onClick={() => onPick('takeaway')} data-testid="takeaway">
          <BagIcon /><span className="arr">→</span>
          <div><b>{lang === 'hi' ? 'पैक कराएँ' : 'Takeaway'}</b><div className="hi">{lang === 'hi' ? 'Takeaway' : 'पैक करवा लेंगे'}</div></div>
        </button>
      </div>
      <div className="foot">Tap to start your order</div>
    </div>
  );
}

/* ---------------- Menu ---------------- */
function MenuScreen(p: {
  lang: Lang; setLang: (l: Lang) => void; type: OrderType; onType: () => void; qtyOf: (id: string) => number;
  onOpen: (id: string) => void; onQuick: (id: string) => void; lines: Line[]; setQty: (uid: string, q: number) => void;
  count: number; total: number; onCart: () => void;
}) {
  const [active, setActive] = useState(CATEGORIES[0].id);
  const main = useRef<HTMLElement>(null);
  const sp = ITEMS.find((i) => i.special)!;
  const title = (i: MenuItem) => (p.lang === 'hi' ? i.hi : i.name);
  const sub = (i: MenuItem) => (p.lang === 'hi' ? i.name : i.hi);

  // Quick +/- on the list adjusts the simplest line for that item; customised lines are edited in the cart.
  const stepper = (i: MenuItem) => {
    const q = p.qtyOf(i.id);
    if (!q) return <button className="add" aria-label={`Add ${i.name}`} onClick={(e) => { e.stopPropagation(); p.onOpen(i.id); }}>+</button>;
    const last = [...p.lines].reverse().find((l) => l.itemId === i.id)!;
    return (
      <div className="step" onClick={(e) => e.stopPropagation()}>
        <button aria-label="less" onClick={() => p.setQty(last.uid, last.qty - 1)}>−</button><span>{q}</span>
        <button aria-label="more" onClick={() => p.setQty(last.uid, last.qty + 1)}>+</button>
      </div>
    );
  };

  const onScroll = () => {
    const m = main.current; if (!m) return;
    let cur = CATEGORIES[0].id;
    for (const c of CATEGORIES) { const el = m.querySelector<HTMLElement>(`#cat-${c.id}`); if (el && el.offsetTop - 120 <= m.scrollTop) cur = c.id; }
    setActive(cur);
  };

  return (
    <div className="screen k-menu">
      <aside>
        <div className="brand"><div className="w">Benne<br /><i>14</i></div><small>Authentic<br />Bangalore Dosa</small></div>
        <div className="cats">
          {CATEGORIES.map((c) => (
            <button key={c.id} className={`cat ${active === c.id ? 'on' : ''}`}
              onClick={() => main.current?.querySelector(`#cat-${c.id}`)?.scrollIntoView({ behavior: 'smooth' })}>
              <div className="n disp">{c.name}</div><div className="k hi">{c.hi}</div>
            </button>
          ))}
        </div>
        <div className="rail-foot">
          <button className="type" onClick={p.onType}><b>{p.type === 'dine_in' ? 'Dine in' : 'Takeaway'}</b><small>Change</small></button>
          <div className="lang">
            <button className={p.lang === 'en' ? 'on' : ''} onClick={() => p.setLang('en')}>EN</button>
            <button className={`hi ${p.lang === 'hi' ? 'on' : ''}`} onClick={() => p.setLang('hi')}>हिंदी</button>
          </div>
        </div>
      </aside>
      <main ref={main} onScroll={onScroll}>
        <section className="hero" onClick={() => p.onOpen(sp.id)} data-testid="hero">
          <Photo item={sp} />
          <div className="offer"><div><b>14%</b><small>Launch<br />off</small></div></div>
          <div className="txt">
            <span className="chip">House special</span>
            <h1 className="disp">Ghee Podi<br />Benne Dosa</h1>
            <div className="meta">
              <p className="hdesc">{sp.desc}</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
                <div><span className="price">₹{sp.price}</span><span className="mrp">₹{sp.mrp}</span></div>{stepper(sp)}
              </div>
            </div>
          </div>
        </section>
        <section className="list">
          {CATEGORIES.map((c) => (
            <div key={c.id}>
              <div className="sec" id={`cat-${c.id}`}><h3 className="disp">{c.name}</h3><span className="hi">{c.hi}</span></div>
              {ITEMS.filter((i) => i.cat === c.id && !i.special).map((i) => (
                <div className="item" key={i.id} role="button" onClick={() => p.onOpen(i.id)} data-testid={`item-${i.id}`}>
                  <div className="ph"><Photo item={i} /></div>
                  <div>
                    <h4>{title(i)}</h4><div className="k hi">{sub(i)}</div>
                    <p className="hdesc">{i.desc}</p>
                    <span className="price">₹{i.price}</span><span className="mrp">₹{i.mrp}</span>
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
          <div className="count"><b>{p.count}</b>{p.count === 1 ? 'item' : 'items'}</div>
          <div className="go"><small>VIEW ORDER</small><span className="tot">₹{p.total}</span><span className="arrow">→</span></div>
        </button>
      )}
    </div>
  );
}

/* ---------------- Item sheet ---------------- */
function ItemSheet({ itemId, editing, pairingInCart, onClose, onAdd }: {
  itemId: string; editing?: Line; pairingInCart: boolean; onClose: () => void; onAdd: (l: CartLine, withPairing: boolean) => void;
}) {
  const item = itemById(itemId)!;
  const [qty, setQty] = useState(editing?.qty ?? 1);
  const [choices, setChoices] = useState<Record<string, string[]>>(() => {
    if (editing) return editing.choices;
    const c: Record<string, string[]> = {};
    for (const g of item.groups) if (GROUPS[g].kind === 'one') c[g] = [GROUPS[g].defaultId!];
    return c;
  });
  const [notes, setNotes] = useState<string[]>(editing?.notes ?? []);
  const [pair, setPair] = useState(false);
  const line: CartLine = { itemId, qty, choices, notes };
  const total = priceLine(line).lineTotal + (pair ? itemById(PAIRING)!.price : 0);
  const showPair = item.id !== PAIRING && item.cat !== 'drinks' && !pairingInCart && !editing;
  const pairing = itemById(PAIRING)!;

  const pick = (g: string, id: string) => setChoices((c) => {
    if (GROUPS[g].kind === 'one') return { ...c, [g]: [id] };
    const cur = c[g] ?? [];
    return { ...c, [g]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] };
  });

  return (
    <>
      <div className="k-sheet-scrim" onClick={onClose} />
      <div className="k-sheet" data-testid="sheet">
        <div className="ph">
          <Photo item={item} big />
          <button className="close" onClick={onClose} aria-label="Close">×</button>
          <div className="head">
            <div>
              {item.special && <span className="chip">House special</span>}
              <h1 className="disp" style={{ marginTop: 14 }}>{item.name}</h1>
              <div className="k hi">{item.hi}</div>
            </div>
            <div style={{ textAlign: 'right' }}><span className="price" style={{ fontSize: 44 }}>₹{item.price}</span><br /><span className="mrp">₹{item.mrp}</span></div>
          </div>
        </div>
        <div className="body">
          <p className="desc hdesc">{item.desc}{item.cat !== 'drinks' && <span className="incl">Comes with coconut chutney &amp; sambar</span>}</p>
          {item.groups.map((gid) => {
            const g = GROUPS[gid];
            const on = choices[gid] ?? [];
            return (
              <div className="grp" key={gid}>
                <div className="gh"><h3 className="disp">{g.name}</h3><small>{g.kind === 'one' ? 'Pick one' : 'Optional'}</small></div>
                {g.kind === 'one' ? (
                  <div className="seg">
                    {g.options.map((o, i) => (
                      <button key={o.id} className={`opt ${on.includes(o.id) ? 'on' : ''}`} onClick={() => pick(gid, o.id)}>
                        <b>{o.name}</b>
                        {gid === 'spice' && <span className="heat">{[0, 1, 2].map((k) => <i key={k} className={k <= i ? 'f' : ''} />)}</span>}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="adds">
                    {g.options.map((o) => (
                      <button key={o.id} className={`addon ${on.includes(o.id) ? 'on' : ''}`} onClick={() => pick(gid, o.id)} data-testid={`addon-${o.id}`}>
                        <span className="box">{on.includes(o.id) ? '✓' : ''}</span><b>{o.name}</b><span className="p">+₹{o.price}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {item.notes && (
            <div className="grp">
              <div className="gh"><h3 className="disp">Note for the kitchen</h3><small>Tap any</small></div>
              <div className="notes">
                {NOTES.map((n) => (
                  <button key={n.id} className={`note ${notes.includes(n.id) ? 'on' : ''}`}
                    onClick={() => setNotes((cur) => (cur.includes(n.id) ? cur.filter((x) => x !== n.id) : [...cur, n.id]))}>{n.label}</button>
                ))}
              </div>
            </div>
          )}
          {showPair && (
            <div className="grp pair">
              <div className="pimg"><Photo item={pairing} /></div>
              <div style={{ flex: 1 }}><small className="eyebrow">Goes well with</small><b>{pairing.name}</b><span className="hi">{pairing.desc}</span></div>
              <span className="price" style={{ fontSize: 26 }}>+₹{pairing.price}</span>
              <button className={`add ${pair ? 'on' : ''}`} onClick={() => setPair((v) => !v)} aria-label="Add filter coffee">{pair ? '✓' : '+'}</button>
            </div>
          )}
        </div>
        <div className="foot">
          <div className="step"><button onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button><span>{qty}</span><button onClick={() => setQty((q) => Math.min(20, q + 1))}>+</button></div>
          <button className="btn-benne" onClick={() => onAdd(line, pair)} data-testid="add-to-order">
            <span>{editing ? 'Update order' : 'Add to order'}</span><span className="amt">₹{total}</span>
          </button>
        </div>
      </div>
    </>
  );
}

/* ---------------- Cart ---------------- */
function Cart(p: {
  lines: Line[]; type: OrderType; setType: (t: OrderType) => void; name: string; setName: (n: string) => void;
  priced: ReturnType<typeof priceOrder>; setQty: (uid: string, q: number) => void; onEdit: (uid: string) => void;
  onAdd: (id: string) => void; onBack: () => void; onPay: () => void;
}) {
  const upsell = CART_UPSELL.filter((id) => !p.lines.some((l) => l.itemId === id)).slice(0, 3);
  return (
    <div className="screen k-cart">
      <div className="top">
        <button className="back" onClick={p.onBack}><span>←</span>Menu</button>
        <h1 className="disp">Your order<small>आपका ऑर्डर</small></h1>
        <div className="seg">
          <button className={p.type === 'dine_in' ? 'on' : ''} onClick={() => p.setType('dine_in')}>Dine-in</button>
          <button className={p.type === 'takeaway' ? 'on' : ''} onClick={() => p.setType('takeaway')}>Takeaway</button>
        </div>
      </div>
      <div className="body">
        {p.lines.map((l, i) => {
          const it = itemById(l.itemId)!;
          const pl = p.priced.lines[i];
          return (
            <div className="line" key={l.uid} data-testid="cart-line">
              <div className="ph"><Photo item={it} /></div>
              <div>
                <h3>{it.name}</h3><div className="hi">{it.hi}</div>
                <div className="mods">
                  {pl.mods.map((m) => <span key={m.groupId + m.id} className={m.price ? 'paid' : ''}>{m.name}{m.price ? ` +₹${m.price}` : ''}</span>)}
                  {pl.notes.map((n) => <span key={n.id}>{n.label}</span>)}
                </div>
                <button className="edit" onClick={() => p.onEdit(l.uid)}>Edit</button>
              </div>
              <div className="right">
                <span className="price">₹{pl.lineTotal}</span>
                {l.qty > 1 && <span className="each">₹{pl.unitPrice} each</span>}
                <div className="step"><button onClick={() => p.setQty(l.uid, l.qty - 1)}>−</button><span>{l.qty}</span><button onClick={() => p.setQty(l.uid, l.qty + 1)}>+</button></div>
              </div>
            </div>
          );
        })}
        {upsell.length > 0 && (
          <div className="more">
            <div className="gh"><h2 className="disp">Kuch aur?</h2><span className="hi">डोसे के साथ ये भी जमेगा</span></div>
            <div className="strip">
              {upsell.map((id) => { const it = itemById(id)!; return (
                <button className="mini" key={id} onClick={() => p.onAdd(id)}>
                  <div className="ph"><Photo item={it} /></div><div><b>{it.name.replace('Udupi ', '')}</b><span className="price">₹{it.price}</span></div><span className="add">+</span>
                </button>
              ); })}
            </div>
          </div>
        )}
        <div className="bill">
          {p.priced.savings > 0 && <div className="saved"><span>Launch offer applied</span><b>You saved ₹{p.priced.savings}</b></div>}
          <div className="rows">
            <div className="row"><span>Item total · {p.priced.itemCount} {p.priced.itemCount === 1 ? 'item' : 'items'}</span><span className="v">₹{p.priced.subtotal.toFixed(2)}</span></div>
            <div className="row muted"><span>CGST 2.5%</span><span className="v">₹{p.priced.cgst.toFixed(2)}</span></div>
            <div className="row muted"><span>SGST 2.5%</span><span className="v">₹{p.priced.sgst.toFixed(2)}</span></div>
            <div className="row muted"><span>Round off</span><span className="v">{p.priced.roundOff < 0 ? '−' : '+'}₹{Math.abs(p.priced.roundOff).toFixed(2)}</span></div>
          </div>
          <div className="total"><span>To pay</span><b data-testid="cart-total">₹{p.priced.total}</b></div>
        </div>
        <div className="name">
          <div><b className="hi">आपको किस नाम से बुलाएँ?</b><span>Optional. We&apos;ll call your name and token when it&apos;s ready.</span></div>
          <input value={p.name} onChange={(e) => p.setName(e.target.value.slice(0, 24))} placeholder="Your name" aria-label="Your name" />
        </div>
      </div>
      <div className="foot">
        <button className="btn-benne" onClick={p.onPay} data-testid="continue-to-pay"><span>Continue to pay</span><span className="amt">₹{p.priced.total} →</span></button>
        <small>UPI · Card · Cash at counter</small>
      </div>
    </div>
  );
}

/* ---------------- Pay ---------------- */
function Pay({ priced, lines, type, name, onBack, onChoose }: {
  priced: ReturnType<typeof priceOrder>; lines: Line[]; type: OrderType; name: string; onBack: () => void; onChoose: (m: PayMethod) => Promise<void>;
}) {
  const [busy, setBusy] = useState<PayMethod | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const choose = async (m: PayMethod) => {
    if (busy) return;
    setBusy(m); setErr(null);
    try { await onChoose(m); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not reach the kitchen. Please try again.'); setBusy(null); }
  };
  return (
    <div className="screen k-pay">
      <button className="back" onClick={onBack} disabled={!!busy}><span>←</span>Order</button>
      <div className="head">
        <div className="amount"><div className="eyebrow">Amount to pay</div><b>₹{priced.total}</b><div className="hi">कैसे पे करना चाहेंगे?</div></div>
        <div className="slip">
          <div className="sh"><span>{type === 'dine_in' ? 'Dine-in' : 'Takeaway'}</span><span>{name.trim() || 'Guest'}</span></div>
          {lines.slice(0, 4).map((l) => <div className="li" key={l.uid}><b>{l.qty}×</b>{itemById(l.itemId)!.name}</div>)}
          {lines.length > 4 && <div className="li"><b>+</b>{lines.length - 4} more</div>}
          <div className="sf">{priced.savings > 0 ? <div className="stamp"><b>₹{priced.savings}</b>saved</div> : <i />}<span>₹{priced.total}</span></div>
        </div>
      </div>
      <button className="tile upi" onClick={() => choose('upi')} disabled={!!busy} data-testid="pay-upi">
        <span className="lead">{busy === 'upi' ? 'Getting your QR ready…' : 'Most people pay this way'}</span>
        <span className="big">UPI</span>
        <span className="hi">किसी भी UPI ऐप से स्कैन करें</span>
        <span className="apps">Google Pay, PhonePe, Paytm, BHIM or any UPI app</span>
        <svg viewBox="0 0 250 312" fill="none" stroke="currentColor" strokeWidth="8" strokeLinejoin="round">
          <rect x="40" y="6" width="170" height="300" rx="28" /><path d="M100 26h50" strokeLinecap="round" />
          <g fill="currentColor" stroke="none">
            <rect x="66" y="70" width="44" height="44" /><rect x="140" y="70" width="44" height="44" /><rect x="66" y="196" width="44" height="44" />
            <rect x="140" y="160" width="14" height="14" /><rect x="160" y="176" width="14" height="14" /><rect x="140" y="196" width="14" height="14" />
            <rect x="170" y="210" width="14" height="14" /><rect x="150" y="226" width="14" height="14" /><rect x="118" y="130" width="14" height="14" />
            <rect x="88" y="140" width="14" height="14" /><rect x="66" y="160" width="14" height="14" /><rect x="118" y="170" width="14" height="14" /><rect x="118" y="214" width="14" height="14" />
          </g>
          <g fill="#F5C542" stroke="none"><rect x="77" y="81" width="22" height="22" /><rect x="151" y="81" width="22" height="22" /><rect x="77" y="207" width="22" height="22" /></g>
          <path d="M20 150h210" stroke="#D14F2B" strokeWidth="6" strokeLinecap="round" />
        </svg>
      </button>
      <div className="row">
        <button className="tile half card" onClick={() => choose('card')} disabled={!!busy} data-testid="pay-card">
          <svg viewBox="0 0 170 110" fill="none" stroke="currentColor" strokeWidth="7" strokeLinejoin="round" strokeLinecap="round"><rect x="4" y="14" width="136" height="90" rx="12" /><rect x="22" y="36" width="30" height="22" rx="4" /><path d="M22 84h44M80 84h22" /><path d="M150 32c8 8 8 26 0 34M160 22c14 14 14 40 0 54" /></svg>
          <span className="big">Card</span><span className="hi">डेबिट / क्रेडिट कार्ड</span><small>Tap or insert on the machine at the counter</small>
        </button>
        <button className="tile half cash" onClick={() => choose('cash')} disabled={!!busy} data-testid="pay-cash">
          <svg viewBox="0 0 170 110" fill="none" stroke="currentColor" strokeWidth="7" strokeLinejoin="round"><rect x="24" y="4" width="140" height="74" rx="8" opacity=".45" /><rect x="4" y="28" width="140" height="78" rx="8" fill="#FFFFFF" /><circle cx="74" cy="67" r="20" /><path d="M66 58h17M66 66h17M70 58c10 0 10 14 0 14l12 12" strokeLinecap="round" strokeWidth="5" /></svg>
          <span className="big">Cash</span><span className="hi">काउंटर पर नकद दें</span><small>Take your token, pay at the counter</small>
        </button>
      </div>
      {err && <div className="err">{err}</div>}
      <div className="note hi">पेमेंट अटक गया? चिंता नहीं, पैसा अपने-आप वापस आ जाएगा।</div>
    </div>
  );
}

/* ---------------- UPI scan ---------------- */
function Upi({ order, onPaid, onOther, onCancel }: { order: Order; onPaid: () => void; onOther: () => void; onCancel: () => void }) {
  const live = useOrder(order.id, 1500);
  const [left, setLeft] = useState(300);
  useEffect(() => { const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { if (live && live.status !== 'pending_payment') onPaid(); }, [live, onPaid]);
  useEffect(() => { if (left === 0) onCancel(); }, [left, onCancel]);
  const mm = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  return (
    <div className="screen k-upi">
      <div className="bar">
        <button className="back" onClick={onOther}><span>←</span>Other ways to pay</button>
        <div className="timer">QR valid for
          <div className="ring"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" fill="none" stroke="#E2D8C7" strokeWidth="5" /><circle cx="32" cy="32" r="28" fill="none" stroke="#9C6A00" strokeWidth="5" strokeLinecap="round" strokeDasharray="176" strokeDashoffset={176 * (1 - left / 300)} /></svg><b>{mm}</b></div>
        </div>
      </div>
      <h1 className="disp">Scan &amp; pay</h1>
      <div className="sub hi">फ़ोन निकालिए, स्कैन कीजिए, बस हो गया।</div>
      <div className="qrcard">
        <span className="corner c1" /><span className="corner c2" /><span className="corner c3" /><span className="corner c4" />
        <img src={`/api/orders/${order.id}/upi`} alt="UPI QR code" />
        <div className="who"><div><b>Benne 14</b><small>Order {order.token} · UPI</small></div><span>₹{order.total}</span></div>
      </div>
      <div className="apps">Works with Google Pay, PhonePe, Paytm, BHIM or any UPI app</div>
      <div className="steps">
        <div><b>1</b>Open any UPI app<span className="hi">ऐप खोलें</span></div>
        <div><b>2</b>Scan this QR<span className="hi">QR स्कैन करें</span></div>
        <div><b>3</b>Enter UPI PIN<span className="hi">PIN डालें, हो गया</span></div>
      </div>
      <div className="wait"><i className="pulse" /><b>Waiting for your payment</b><span className="hi">· पेमेंट होते ही आगे बढ़ेंगे</span></div>
      <div className="foot">
        <span>Demo mode: no real money moves.</span>
        <button className="sim" onClick={() => api.mockPay(order.id)} data-testid="simulate-paid">Simulate payment</button>
        <button onClick={onCancel}>Cancel order</button>
      </div>
    </div>
  );
}

/* ---------------- Done ---------------- */
function Done({ orderId, first, onDone }: { orderId: string; first: Order | null; onDone: () => void }) {
  const live = useOrder(orderId, 2000);
  const o = live ?? first;
  const [left, setLeft] = useState(DONE_RESET_S);
  useEffect(() => { const t = setInterval(() => setLeft((s) => s - 1), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { if (left <= 0) onDone(); }, [left, onDone]);
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);
  if (!o) return null;
  const atCounter = o.status === 'awaiting_cash';
  const stage = o.status === 'ready' || o.status === 'handed_over' ? 2 : o.status === 'cooking' ? 1 : 0;
  return (
    <div className="screen k-done">
      {atCounter
        ? <div className="paid due"><i>₹</i>Pay ₹{o.total} at the counter · {o.payMethod === 'card' ? 'card machine' : 'cash'}</div>
        : <div className="paid"><i>✓</i>Payment received · ₹{o.total} via UPI</div>}
      <div className="thanks"><h1>शुक्रिया{o.customerName ? <>, <b>{o.customerName}</b></> : ''}! {atCounter ? 'पेमेंट होते ही डोसा तवे पर।' : 'आपका डोसा तवे पर है।'}</h1></div>
      <div className="token" data-testid="token">
        <div className="tt"><span>Benne 14 · Token</span><span>{o.type === 'dine_in' ? 'Dine-in' : 'Takeaway'}</span></div>
        <div className="num">{o.token}</div>
        <div className="perf" />
        <div className="tb"><b>{o.customerName ? `${o.customerName} · ` : ''}{o.itemCount} {o.itemCount === 1 ? 'item' : 'items'}</b><span>{atCounter ? 'Show at counter' : 'Ready in ~8 min'}</span></div>
      </div>
      <div className="watch">
        <svg viewBox="0 0 56 56" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round"><rect x="5" y="9" width="46" height="30" rx="4" /><path d="M20 47h16M28 39v8" /><path d="M15 24h8M28 24h13" strokeLinecap="round" /></svg>
        <div><b>Watch the screen near the counter</b>We&apos;ll show {o.token}{o.customerName ? ' and call your name' : ''} when it&apos;s ready.</div>
      </div>
      <div className="track">
        <div className="st done"><i>✓</i><b>Order received</b><span className="hi">ऑर्डर मिल गया</span></div>
        <div className={`ln ${stage >= 1 ? 'on' : ''}`} />
        <div className={`st ${stage === 1 ? 'now' : stage > 1 ? 'done' : ''}`}><i>{stage > 1 ? '✓' : ''}</i><b>On the tawa</b><span className="hi">बन रहा है</span></div>
        <div className={`ln ${stage >= 2 ? 'on' : ''}`} />
        <div className={`st ${stage === 2 ? 'done' : ''}`}><i>{stage === 2 ? '✓' : ''}</i><b>Ready to collect</b><span className="hi">लेने आ जाइए</span></div>
      </div>
      <div className="receipt">
        <div className="q">{origin && <img src={`/api/qr?u=${encodeURIComponent(`${origin}/r/${o.id}`)}`} alt="Scan for your bill" />}</div>
        <div><h3 className="disp">Track &amp; bill on your phone</h3><p>Scan to follow your order live and get the GST bill. No paper, no waiting.</p></div>
      </div>
      <div className="reset">
        <div><span>Starting a fresh order in {Math.max(0, left)}s</span><div className="bar"><i style={{ width: `${(Math.max(0, left) / DONE_RESET_S) * 100}%` }} /></div></div>
        <button onClick={onDone}>Done</button>
      </div>
    </div>
  );
}

/* ---------------- Still there? ---------------- */
function Idle({ onStay, onReset }: { onStay: () => void; onReset: () => void }) {
  const [left, setLeft] = useState(IDLE_GRACE_S);
  useEffect(() => { const t = setInterval(() => setLeft((s) => s - 1), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { if (left <= 0) onReset(); }, [left, onReset]);
  return (
    <div className="k-idle">
      <div className="box">
        <h2 className="disp">Still there?</h2>
        <p className="hi">अभी ऑर्डर कर रहे हैं? {Math.max(0, left)} सेकंड में नया ऑर्डर शुरू होगा।</p>
        <div className="btns"><button className="no" onClick={onReset}>Start over</button><button className="yes" onClick={onStay}>Yes, I&apos;m here</button></div>
      </div>
    </div>
  );
}
