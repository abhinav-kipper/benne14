'use client';
// The kiosk: holds the cart and which screen is showing; each screen lives in ./screens.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CatalogProvider, useMenu } from '@/components/Catalog';
import { api, ApiError, newKey, useAutoReload } from '@/lib/client';
import { PAIRING } from '@/lib/menu';
import type { Order, OrderType, PayMethod } from '@/lib/orders';
import { priceOrder, type CartLine } from '@/lib/pricing';
import { Cart } from './screens/Cart';
import { Done } from './screens/Done';
import { Home } from './screens/Home';
import { Idle } from './screens/Idle';
import { ItemSheet } from './screens/ItemSheet';
import { MenuScreen } from './screens/Menu';
import { Pay } from './screens/Pay';
import { IDLE_MS, type Line, type Screen } from './screens/shared';
import { Upi } from './screens/Upi';

const sameChoices = (a: CartLine, b: CartLine) =>
  a.itemId === b.itemId && JSON.stringify(a.choices) === JSON.stringify(b.choices) && JSON.stringify([...a.notes].sort()) === JSON.stringify([...b.notes].sort());

export default function Kiosk({ mock = false, testMode = false }: { mock?: boolean; testMode?: boolean }) {
  const [screen, setScreen] = useState<Screen>('home');
  const [type, setType] = useState<OrderType | null>(null); // asked at the end, in the cart
  const [lines, setLines] = useState<Line[]>([]);
  const [sheet, setSheet] = useState<{ itemId: string; editing?: string } | null>(null);
  const [name, setName] = useState('');
  const [orderId, setOrderId] = useState<string | null>(null);
  const [placed, setPlaced] = useState<Order | null>(null);
  const [idle, setIdle] = useState(false);
  const checkoutKey = useRef(newKey());

  // The owner's changes (prices, names, sold out) are picked up each time the kiosk shows the start
  // screen, i.e. for every new customer. If it can't load, the kiosk keeps the last menu it had.
  const { catalog, reload: loadMenu } = useMenu();
  useEffect(() => { if (screen === 'home') loadMenu(); }, [screen, loadMenu]);
  useAutoReload(screen === 'home'); // pick up a new version between customers, never mid-order

  const reset = useCallback(() => {
    setScreen('home'); setType(null); setLines([]); setSheet(null); setName(''); setOrderId(null); setPlaced(null); setIdle(false);
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

  const priced = useMemo(() => (lines.length ? priceOrder(lines, catalog) : null), [lines, catalog]);
  const count = priced?.itemCount ?? 0;

  const addLine = (l: CartLine) => setLines((cur) => {
    const same = cur.find((x) => sameChoices(x, l));
    return same ? cur.map((x) => (x === same ? { ...x, qty: Math.min(20, x.qty + l.qty) } : x)) : [...cur, { ...l, uid: newKey() }];
  });
  const quickAdd = (itemId: string) => addLine({ itemId, qty: 1, choices: {}, notes: [] });
  const setQty = (uid: string, qty: number) => setLines((cur) => (qty <= 0 ? cur.filter((l) => l.uid !== uid) : cur.map((l) => (l.uid === uid ? { ...l, qty: Math.min(20, qty) } : l))));
  const qtyOf = (itemId: string) => lines.filter((l) => l.itemId === itemId).reduce((a, l) => a + l.qty, 0);

  return (
    <CatalogProvider value={catalog}>
    <div className="kiosk">
      {screen === 'home' && <Home onStart={() => setScreen('menu')} />}
      {screen === 'menu' && (
        <MenuScreen testMode={testMode} qtyOf={qtyOf}
          onOpen={(id) => setSheet({ itemId: id })} onQuick={quickAdd}
          lines={lines} setQty={setQty} count={count} total={priced?.total ?? 0} onCart={() => setScreen('cart')} />
      )}
      {screen === 'cart' && priced && (
        <Cart lines={lines} type={type} setType={setType} name={name} setName={setName} priced={priced}
          setQty={setQty} onEdit={(uid) => { const l = lines.find((x) => x.uid === uid)!; setSheet({ itemId: l.itemId, editing: uid }); }}
          onAdd={quickAdd} onBack={() => setScreen('menu')} onPay={() => setScreen('pay')} />
      )}
      {screen === 'cart' && !priced && <EmptyRedirect go={() => setScreen('menu')} />}
      {screen === 'pay' && priced && type && (
        <Pay priced={priced} lines={lines} type={type} name={name} onBack={() => setScreen('cart')}
          onChoose={async (m: PayMethod) => {
            let o: Order;
            try {
              o = await api.placeOrder({ key: checkoutKey.current, type, name: name.trim() || null, payMethod: m, lines: lines.map(({ uid: _u, ...l }) => l) });
            } catch (e) {
              if (e instanceof ApiError && e.status === 409) loadMenu(); // something sold out meanwhile: the cart will show which
              throw e;
            }
            setOrderId(o.id); setPlaced(o);
            setScreen(m === 'upi' ? 'upi' : 'done');
          }} />
      )}
      {screen === 'upi' && placed && (
        <Upi order={placed} mock={mock} onPaid={() => setScreen('done')} onOther={() => { checkoutKey.current = newKey(); setOrderId(null); setPlaced(null); setScreen('pay'); }} onCancel={reset} />
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
      {testMode && <div className="k-test" data-testid="test-ribbon">Test mode · cash = paid</div>}
      {idle && <Idle onStay={() => { lastTouch.current = Date.now(); setIdle(false); }} onReset={reset} />}
    </div>
    </CatalogProvider>
  );
}

function EmptyRedirect({ go }: { go: () => void }) {
  useEffect(() => { go(); }, [go]);
  return null;
}
