'use client';
// The kiosk: holds the cart and which screen is showing; each screen lives in ./screens.
import { PinGate } from '@/components/PinGate';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CatalogProvider, useMenu } from '@/components/Catalog';
import { api, ApiError, newKey, useAutoReload, useAwake, useNightlyReload, useServerUp, useWatch } from '@/lib/client';
import { cleanPhone, type DiscountRule, type KioskSettings } from '@/lib/discounts';
import { PAIRING, notesFor } from '@/lib/menu';
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
  a.itemId === b.itemId &&
  JSON.stringify(a.choices) === JSON.stringify(b.choices) &&
  JSON.stringify([...a.notes].sort()) === JSON.stringify([...b.notes].sort());

const UPI_RETRY_MS = 2 * 60_000;

export default function Kiosk({ mock = false, testMode = false }: { mock?: boolean; testMode?: boolean }) {
  const [screen, setScreen] = useState<Screen>('home');
  const [type, setType] = useState<OrderType | null>(null); // asked at the end, in the cart
  const [cartLines, setLines] = useState<Line[]>([]);
  const [sheet, setSheet] = useState<{ itemId: string; editing?: string } | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState<DiscountRule | null>(null); // a discount code the server said works
  // What the cart asks for, as the owner switched it. Off until the server says otherwise.
  const [asks, setAsks] = useState<KioskSettings>({ codes: false, phone: false, cash: false });
  // Has staff set this tablet up as the shop's kiosk? null until the server has said. Only a clear
  // "no" shows the PIN pad: a failed request must not lock a working kiosk.
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  // UPI went unanswered a moment ago: the pay screen offers card and cash only until this time,
  // then tries UPI again (the gateway is usually back within minutes).
  const [upiOffUntil, setUpiOffUntil] = useState(0);
  const [popular, setPopular] = useState<string[]>([]); // best sellers, for the cart's suggestions
  const [orderId, setOrderId] = useState<string | null>(null);
  const [placed, setPlaced] = useState<Order | null>(null);
  const [idle, setIdle] = useState(false);
  const checkoutKey = useRef(newKey());
  const menuScroll = useRef<{ top: number; cat: string | null }>({ top: 0, cat: null });

  // The owner's changes (prices, names, sold out) are picked up each time the kiosk shows the start
  // screen, i.e. for every new customer. If it can't load, the kiosk keeps the last menu it had.
  const { catalog, reload: loadMenu } = useMenu();
  // A dish the owner takes off the menu while it sits in a cart simply leaves the cart.
  // So does an extra or a kitchen note the owner switches off: the dish stays, without it.
  const lines = useMemo(
    () =>
      cartLines.flatMap((l) => {
        const item = catalog.items.find((i) => i.id === l.itemId);
        if (!item) return [];
        const choices: Line['choices'] = {};
        for (const g of item.groups) {
          const have = new Set(catalog.groups[g].options.map((o) => o.id));
          const kept = (l.choices[g] ?? []).filter((id) => have.has(id));
          if (kept.length) choices[g] = kept;
        }
        const allowed = new Set(notesFor(item, catalog).map((n) => n.id));
        const notes = l.notes.filter((id) => allowed.has(id));
        const same =
          notes.length === l.notes.length &&
          Object.keys(l.choices).every((g) => (choices[g]?.length ?? 0) === l.choices[g].length);
        return [same ? l : { ...l, choices, notes }];
      }),
    [cartLines, catalog],
  );
  useEffect(() => {
    if (screen !== 'home') return;
    loadMenu();
    api
      .kiosk()
      .then((k) => {
        setAsks(k);
        setEnrolled(k.enrolled);
      })
      .catch(() => {}); // keep the last answer if the request fails
    api
      .popular()
      .then((r) => setPopular(r.ids))
      .catch(() => {});
  }, [screen, loadMenu]);
  // …and every half minute while a customer is choosing, so a price or sold-out change made on the
  // dashboard shows on the menu, the dish sheet and the cart's suggestions without waiting for the
  // next customer. (The server prices the order from the same menu at checkout either way.)
  useEffect(() => {
    if (screen !== 'menu' && screen !== 'cart') return;
    const t = setInterval(loadMenu, 30_000);
    return () => clearInterval(t);
  }, [screen, loadMenu]);
  useAutoReload(screen === 'home'); // pick up a new version between customers, never mid-order
  useNightlyReload(screen === 'home');
  useAwake();
  useWatch('kiosk', screen);
  // While the shop can't take an order (Wi-Fi or database down) customers are sent to the counter.
  // Not on the payment and order-number screens: an order that exists must be seen through.
  const [up, serverSeen] = useServerUp(screen !== 'upi' && screen !== 'done');
  // Nor while an order is on its way to the server: a slow moment would otherwise flash "order at
  // the counter" between the customer's tap and their QR. That order answers for itself.
  const [placing, setPlacing] = useState(false);
  const closed = !up && !placing && screen !== 'upi' && screen !== 'done';

  const reset = useCallback(() => {
    setScreen('home');
    setType(null);
    setLines([]);
    setSheet(null);
    setName('');
    setPhone('');
    setCode(null);
    setOrderId(null);
    setPlaced(null);
    setIdle(false);
    checkoutKey.current = newKey();
    menuScroll.current = { top: 0, cat: null };
  }, []);

  // Idle watch: anything the customer does resets the timer (a tap, a finger moving, the menu
  // scrolling, typing a name); on non-home screens ask "Still there?" before clearing.
  const lastTouch = useRef(Date.now());
  useEffect(() => {
    const touch = () => {
      lastTouch.current = Date.now();
    };
    // scroll does not bubble, so it is caught on the way down; passive: never slows the scroll itself
    const acts = ['pointerdown', 'pointermove', 'touchstart', 'touchmove', 'wheel', 'keydown', 'input', 'scroll'];
    for (const a of acts) window.addEventListener(a, touch, { capture: true, passive: true });
    const t = setInterval(() => {
      if (
        screen !== 'home' &&
        screen !== 'done' &&
        screen !== 'upi' &&
        !idle &&
        Date.now() - lastTouch.current > IDLE_MS
      )
        setIdle(true);
    }, 1000);
    return () => {
      for (const a of acts) window.removeEventListener(a, touch, { capture: true });
      clearInterval(t);
    };
  }, [screen, idle]);

  const priced = useMemo(() => (lines.length ? priceOrder(lines, catalog, code) : null), [lines, catalog, code]);
  const count = priced?.itemCount ?? 0;

  const addLine = (l: CartLine) =>
    setLines((cur) => {
      const same = cur.find((x) => sameChoices(x, l));
      return same
        ? cur.map((x) => (x === same ? { ...x, qty: Math.min(20, x.qty + l.qty) } : x))
        : [...cur, { ...l, uid: newKey() }];
    });
  // The cart's suggestions add a dish as it comes: every pick-one choice at its default, no extras, no notes.
  // Written out in full so it merges with the same dish added from the sheet without changes.
  const quickAdd = (itemId: string) => {
    const item = catalog.items.find((i) => i.id === itemId);
    const choices: Record<string, string[]> = {};
    for (const g of item?.groups ?? [])
      if (catalog.groups[g].kind === 'one') choices[g] = [catalog.groups[g].defaultId!];
    addLine({ itemId, qty: 1, choices, notes: [] });
  };
  const setQty = (uid: string, qty: number) =>
    setLines((cur) =>
      qty <= 0
        ? cur.filter((l) => l.uid !== uid)
        : cur.map((l) => (l.uid === uid ? { ...l, qty: Math.min(20, qty) } : l)),
    );
  const qtyOf = (itemId: string) => lines.filter((l) => l.itemId === itemId).reduce((a, l) => a + l.qty, 0);

  return (
    <CatalogProvider value={catalog}>
      <div className="kiosk">
        {enrolled === false && (
          <div className="k-setup" data-testid="kiosk-setup">
            <PinGate
              title="Set up this kiosk"
              ask="Staff: enter the staff PIN once. Customers can then order on this tablet."
              note={null}
              onPin={(pin) =>
                api
                  .enrolKiosk(pin)
                  .then(() => setEnrolled(true))
                  .catch(() => {})
              }
            />
          </div>
        )}
        {closed && (
          <div className="k-counter" data-testid="counter-please">
            <div className="logo">
              Benne <i>14</i>
            </div>
            <h1 className="disp">
              Please order
              <br />
              at the <em>counter.</em>
            </h1>
            <p>This screen will be back in a moment.</p>
          </div>
        )}
        {screen === 'home' && <Home onStart={() => setScreen('menu')} />}
        {screen === 'menu' && (
          <MenuScreen
            testMode={testMode}
            scrollMemo={menuScroll}
            qtyOf={qtyOf}
            onOpen={(id) => setSheet({ itemId: id })}
            lines={lines}
            setQty={setQty}
            count={count}
            total={priced?.total ?? 0}
            onCart={() => setScreen('cart')}
          />
        )}
        {screen === 'cart' && priced && (
          <Cart
            lines={lines}
            type={type}
            setType={setType}
            name={name}
            setName={setName}
            asks={asks}
            popular={popular}
            phone={phone}
            setPhone={setPhone}
            code={code}
            onCode={async (typed) => {
              // The server decides; the cart only shows what it will charge.
              const r = await api.checkCode(
                typed,
                lines.map(({ uid: _u, ...l }) => l),
              );
              setCode(r.rule);
            }}
            onCodeRemove={() => setCode(null)}
            priced={priced}
            setQty={setQty}
            onEdit={(uid) => {
              const l = lines.find((x) => x.uid === uid)!;
              setSheet({ itemId: l.itemId, editing: uid });
            }}
            onAdd={quickAdd}
            onBack={() => setScreen('menu')}
            onPay={() => setScreen('pay')}
          />
        )}
        {screen === 'cart' && !priced && <EmptyRedirect go={() => setScreen('menu')} />}
        {screen === 'pay' && priced && type && (
          <Pay
            priced={priced}
            lines={lines}
            type={type}
            name={name}
            onBack={() => setScreen('cart')}
            noUpi={Date.now() < upiOffUntil}
            cash={asks.cash}
            onChoose={async (m: PayMethod) => {
              let o: Order;
              setPlacing(true);
              try {
                o = await api.placeOrder({
                  key: checkoutKey.current,
                  type,
                  name: name.trim() || null,
                  payMethod: m,
                  lines: lines.map(({ uid: _u, ...l }) => l),
                  code: priced.discountCode, // only a code that is actually taking money off
                  phone: asks.phone ? cleanPhone(phone) : null,
                  expectTotal: priced.total,
                });
              } catch (e) {
                if (e instanceof ApiError && e.status === 409) loadMenu(); // something sold out meanwhile: the cart will show which
                if (e instanceof ApiError && e.status === 401) setEnrolled(false); // the staff PIN was changed: set up again
                throw e;
              } finally {
                setPlacing(false);
              }
              serverSeen(); // it just took an order: it is up, whatever the last check said
              setOrderId(o.id);
              setPlaced(o);
              setScreen(m === 'upi' ? 'upi' : 'done');
            }}
          />
        )}
        {screen === 'upi' && placed && (
          <Upi
            order={placed}
            mock={mock}
            onPaid={() => setScreen('done')}
            onOther={() => {
              checkoutKey.current = newKey();
              setOrderId(null);
              setPlaced(null);
              setScreen('pay');
            }}
            onCancel={reset}
            onDown={() => {
              checkoutKey.current = newKey();
              setOrderId(null);
              setPlaced(null);
              setUpiOffUntil(Date.now() + UPI_RETRY_MS);
              setScreen('pay');
            }}
          />
        )}
        {screen === 'done' && orderId && <Done orderId={orderId} first={placed} onDone={reset} />}

        {sheet && catalog.items.some((i) => i.id === sheet.itemId) && (
          <ItemSheet
            key={sheet.itemId + (sheet.editing ?? '')}
            itemId={sheet.itemId}
            editing={lines.find((l) => l.uid === sheet.editing)}
            pairingInCart={qtyOf(PAIRING) > 0}
            onClose={() => setSheet(null)}
            onAdd={(l, withPairing) => {
              if (sheet.editing)
                setLines((cur) => cur.map((x) => (x.uid === sheet.editing ? { ...l, uid: x.uid } : x)));
              else addLine(l);
              if (withPairing) quickAdd(PAIRING);
              setSheet(null);
            }}
          />
        )}
        {idle && (
          <Idle
            onStay={() => {
              lastTouch.current = Date.now();
              setIdle(false);
            }}
            onReset={reset}
          />
        )}
      </div>
    </CatalogProvider>
  );
}

function EmptyRedirect({ go }: { go: () => void }) {
  useEffect(() => {
    go();
  }, [go]);
  return null;
}
