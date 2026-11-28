'use client';
// Is everything in the shop working? Every screen and when it was last heard from, what needs a
// look, and the latest errors. The numbers come from /api/admin/system; the rules are in lib/system.ts.
import { useCallback, useEffect, useState } from 'react';
import { admin, ApiError, type SystemReport } from '@/lib/client';
import { phonePretty, SHOP } from '@/lib/shop';
import { ago, isOnline, kindName, type DeviceKind } from '@/lib/system';
import { Bar, time, type Ctx } from './shared';

const SHOP_SCREENS: DeviceKind[] = ['kiosk', 'kitchen', 'board'];
const SHOWING: Record<string, string> = {
  home: 'start screen',
  menu: 'a customer is choosing',
  cart: 'a customer is at the cart',
  pay: 'a customer is paying',
  upi: 'a customer is paying by UPI',
  done: 'showing an order number',
};

// The one line on the Today screen: green when all is well, red with a count when it is not.
export function SystemLine({ sys, open }: { sys: SystemReport | null; open: () => void }) {
  const bad = sys?.problems.filter((x) => x.level !== 'info') ?? [];
  const worst = bad.some((x) => x.level === 'bad') ? 'bad' : bad.length ? 'warn' : 'ok';
  return (
    <button className={`sysline ${sys ? worst : 'wait'}`} onClick={open} data-testid="sysline">
      <i />
      <span>
        {!sys
          ? 'Checking the shop’s screens…'
          : bad.length === 0
            ? 'Everything is working'
            : bad.length === 1
              ? bad[0].text
              : `${bad.length} things need a look`}
      </span>
      <b>System ›</b>
    </button>
  );
}

export function System({
  sys,
  reload,
  back,
  openTech,
  ...ctx
}: Ctx & { sys: SystemReport | null; reload: () => Promise<unknown>; back: () => void; openTech: () => void }) {
  const [open, setOpen] = useState<number | null>(null);
  const now = sys ? Date.parse(sys.now) : 0;
  return (
    <section data-testid="system">
      <Bar
        right={
          <>
            <b>System</b>
            {sys ? `Checked ${time(sys.now)}` : 'Checking…'}
          </>
        }
      />
      <div className="h1">
        <button className="hback" onClick={back} aria-label="Back to today">
          ←
        </button>
        System
      </div>
      {!sys && <div className="none pad">Checking…</div>}
      {sys && (
        <>
          <div className="sysprob" data-testid="problems">
            {sys.problems.filter((x) => x.level !== 'info').length === 0 && (
              <div className="prob ok">
                <b>Everything is working</b>
                <span>All screens are answering and nothing has gone wrong lately.</span>
              </div>
            )}
            {sys.problems.map((x, n) => (
              <div className={`prob ${x.level}`} key={n}>
                <b>{x.text}</b>
                {x.hint && <span>{x.hint}</span>}
              </div>
            ))}
          </div>

          <Screens {...ctx} sys={sys} now={now} reload={reload} />

          <Notify {...ctx} phones={sys.phones} />

          {sys.alerts.length > 0 && (
            <div className="mcat" data-testid="alerts">
              <h3>Alerts</h3>
              {sys.alerts.map((a) => (
                <div className={`dev ${a.clearedAt ? 'done' : 'off'}`} key={a.key}>
                  <i />
                  <div>
                    <b>{a.text}</b>
                    <span>
                      {a.clearedAt
                        ? `Sorted ${ago(a.clearedAt, now)} · began ${ago(a.firstAt, now)}`
                        : `Still going · began ${ago(a.firstAt, now)}`}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mcat">
            <h3>Latest errors</h3>
            {sys.errors.length === 0 && <div className="none">Nothing has gone wrong.</div>}
            {sys.errors.map((e, n) => (
              <button
                className={`errrow ${open === n ? 'open' : ''}`}
                key={n}
                onClick={() => setOpen(open === n ? null : n)}
                data-testid="errrow"
              >
                <span className="when">
                  {ago(e.at, now)}
                  <small>
                    {e.source === 'server' ? 'Server' : e.source === 'bill' ? 'Phone bill' : kindName(e.source)}
                  </small>
                </span>
                <span className="what">
                  {e.message}
                  {open === n && e.detail && <code>{e.detail}</code>}
                </span>
              </button>
            ))}
          </div>

          <div className="sysfoot">
            Version {sys.build.slice(0, 7)} · database {sys.store === 'supabase' ? 'connected' : 'in memory'} · UPI by{' '}
            {sys.payments === 'easebuzz'
              ? 'Easebuzz'
              : sys.payments === 'instacollect'
                ? 'Easebuzz InstaCollect'
                : sys.payments === 'mock'
                  ? 'test payments'
                  : 'the shop’s own QR'}
          </div>
          <div className="mcat" data-testid="shop-details">
            <h3>On every bill</h3>
            <div className="dev on">
              <i />
              <div>
                <b>{SHOP.name}</b>
                <span>{SHOP.address.join(', ')}</span>
              </div>
            </div>
            <div className="dev on">
              <i />
              <div>
                <b>GSTIN {SHOP.gstin}</b>
                <span>
                  5% GST (2.5% CGST + 2.5% SGST) · SAC {SHOP.sac} · {SHOP.state.name}
                </span>
              </div>
            </div>
            <div className="dev on">
              <i />
              <div>
                <b>FSSAI Reg. No. {SHOP.fssai.number}</b>
                <span>
                  Fee paid up to {SHOP.fssai.feePaidUpto} · phone {phonePretty(SHOP.phone)}
                </span>
              </div>
            </div>
            <div className="was">If any of this is wrong or changes, tell whoever looks after the app.</div>
          </div>
          <button className="techlink" onClick={openTech} data-testid="open-tech">
            Technical detail ›
          </button>
        </>
      )}
    </section>
  );
}

// The shop has one kiosk, one kitchen tablet and one TV. Any phone or laptop that opens the same
// address shows up too, so the owner says once which device is the shop's own: after that only
// those three are watched, and the rest sit in a short list that can be cleared.
const THE: Record<string, string> = { kiosk: 'kiosk', kitchen: 'kitchen screen', board: 'TV' };
function Screens({
  pin,
  onAuthError,
  sys,
  now,
  reload,
}: Ctx & { sys: SystemReport; now: number; reload: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [ask, setAsk] = useState(false);
  const change = async (b: Parameters<typeof admin.systemChange>[1]) => {
    setBusy(true);
    setNote(null);
    try {
      await admin.systemChange(pin, b);
      await reload();
    } catch (e) {
      onAuthError(e);
      setNote(e instanceof ApiError ? e.message : 'That did not work. Check the internet and try again.');
    }
    setBusy(false);
    setAsk(false);
  };
  const status = (d: SystemReport['devices'][number]) => {
    const on = isOnline(d, now);
    return (
      (on
        ? `Online${d.screen && SHOWING[d.screen] ? ` · ${SHOWING[d.screen]}` : ''}`
        : `Silent · last heard ${ago(d.seenAt, now)}`) +
      (on && d.build && d.build !== sys.build ? ' · old version' : '')
    );
  };
  const others = sys.devices.filter((d) => d.kind !== 'owner' && !d.shop);
  return (
    <div className="mcat" data-testid="screens">
      <h3>Screens</h3>
      {SHOP_SCREENS.map((kind) => {
        const all = sys.devices.filter((d) => d.kind === kind);
        const mine = all.find((d) => d.shop);
        if (!mine)
          return (
            <div className="dev none-yet" key={kind} data-testid={`dev-${kind}`}>
              <i />
              <div>
                <b>{kindName(kind)}</b>
                <span>
                  {all.length
                    ? `Not picked yet. Choose the shop’s ${THE[kind]} from the list below.`
                    : 'Not connected yet. It appears here once that screen is opened.'}
                </span>
              </div>
            </div>
          );
        const on = isOnline(mine, now);
        return (
          <div className={`dev ${on ? 'on' : 'off'}`} key={kind} data-testid={`dev-${kind}`}>
            <i />
            <div>
              <b>{kindName(kind)}</b>
              <span>{status(mine)}</span>
            </div>
            <button
              className="devbtn"
              disabled={busy}
              onClick={() => change({ notShop: mine.id })}
              data-testid={`unpick-${kind}`}
            >
              Change
            </button>
          </div>
        );
      })}
      <div className="was">
        A screen counts as silent after two minutes without a word: it is off, asleep or has lost Wi-Fi.
      </div>

      {others.length > 0 && (
        <div className="otherdevs" data-testid="other-devices">
          <h4>Other devices ({others.length})</h4>
          <div className="was">
            Phones and laptops that opened one of the screens. They are not watched once the shop’s own screens are
            picked. A forgotten device comes back if it opens the screen again.
          </div>
          {others.map((d) => {
            const on = isOnline(d, now);
            return (
              <div className={`dev other ${on ? 'on' : 'idle'}`} key={d.id} data-testid="other-device">
                <i />
                <div>
                  <b>{kindName(d.kind)} on another device</b>
                  <span>
                    {on ? status(d) : `Last heard ${ago(d.seenAt, now)}`} · first opened {ago(d.firstSeen, now)}
                  </span>
                  <div className="devacts">
                    <button disabled={busy} onClick={() => change({ shop: d.id })} data-testid="pick">
                      This is the shop’s {THE[d.kind]}
                    </button>
                    <button disabled={busy} onClick={() => change({ forget: d.id })} data-testid="forget">
                      Forget
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          {others.length > 1 &&
            (ask ? (
              <div className="actions">
                <button
                  className="btn y"
                  disabled={busy}
                  onClick={() => change({ forgetOthers: true })}
                  data-testid="forget-all-yes"
                >
                  Yes, forget all {others.length}
                </button>
                <button className="btn o" disabled={busy} onClick={() => setAsk(false)}>
                  Keep them
                </button>
              </div>
            ) : (
              <div className="actions">
                <button className="btn o" disabled={busy} onClick={() => setAsk(true)} data-testid="forget-all">
                  Forget all others
                </button>
              </div>
            ))}
        </div>
      )}
      {note && (
        <div className="prob warn" data-testid="screens-note">
          <b>{note}</b>
        </div>
      )}
    </div>
  );
}

// "Tell this phone when something is wrong." A notification is a browser feature that the person
// holding the phone switches on: only phones where someone taps this button ever get one.
type NotifyState = 'checking' | 'off' | 'on' | 'blocked' | 'unsupported';
const keyBytes = (b64: string) => {
  const raw = atob(
    b64
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(b64.length / 4) * 4, '='),
  );
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

function Notify({ pin, onAuthError, phones }: Ctx & { phones: number }) {
  const [state, setState] = useState<NotifyState>('checking');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const supported = () =>
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;
  const check = useCallback(async () => {
    if (!supported()) return setState('unsupported');
    if (Notification.permission === 'denied') return setState('blocked');
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    setState((await reg?.pushManager.getSubscription()) ? 'on' : 'off');
  }, []);
  useEffect(() => {
    check().catch(() => setState('off'));
  }, [check]);

  const run = async (what: () => Promise<string | null>) => {
    setBusy(true);
    setNote(null);
    try {
      setNote(await what());
    } catch (e) {
      onAuthError(e);
      setNote(e instanceof ApiError ? e.message : 'That did not work. Check the internet and try again.');
    }
    setBusy(false);
    check().catch(() => {});
  };
  const turnOn = () =>
    run(async () => {
      if ((await Notification.requestPermission()) !== 'granted')
        return 'Notifications were not allowed on this phone.';
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const { publicKey } = await admin.pushInfo(pin);
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
      await admin.pushChange(pin, { subscribe: sub.toJSON() });
      await admin.pushChange(pin, { test: true });
      return 'On. A test notification is on its way to this phone.';
    });
  const turnOff = () =>
    run(async () => {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await admin.pushChange(pin, { unsubscribe: sub.endpoint });
        await sub.unsubscribe();
      }
      return 'Off for this phone.';
    });
  const test = () =>
    run(async () => {
      const { sent } = await admin.pushChange(pin, { test: true });
      return sent ? `Sent to ${sent} ${sent === 1 ? 'phone' : 'phones'}.` : 'No phone has notifications on yet.';
    });

  return (
    <div className="mcat" data-testid="notify">
      <h3>Alerts on this phone</h3>
      <div className="was">
        A notification when the kiosk, kitchen screen or TV goes silent, when errors pile up, or when a payment needs a
        look. Only phones where this is switched on get them.{' '}
        {phones > 0 && `On for ${phones} ${phones === 1 ? 'phone' : 'phones'} now.`}
      </div>
      {state === 'unsupported' && (
        <div className="prob warn">
          <b>This browser can’t show notifications yet</b>
          <span>
            On an iPhone: tap Share, then “Add to Home Screen”, and open the owner app from that icon. On Android, use
            Chrome.
          </span>
        </div>
      )}
      {state === 'blocked' && (
        <div className="prob warn">
          <b>Notifications are blocked for this site</b>
          <span>Allow them in the phone’s browser settings for this site, then come back here.</span>
        </div>
      )}
      <div className="actions">
        {state === 'off' && (
          <button className="btn y" disabled={busy} onClick={turnOn} data-testid="notify-on">
            {busy ? 'Turning on…' : 'Turn on notifications'}
          </button>
        )}
        {state === 'on' && (
          <>
            <button className="btn o" disabled={busy} onClick={test} data-testid="notify-test">
              Send a test
            </button>
            <button className="btn o" disabled={busy} onClick={turnOff} data-testid="notify-off">
              Turn off for this phone
            </button>
          </>
        )}
      </div>
      {note && (
        <div className="was" data-testid="notify-note">
          {note}
        </div>
      )}
    </div>
  );
}
