'use client';
// Offers: what the kiosk's cart asks for (two switches), the discount codes, and the phone numbers
// customers gave for offers. Nothing here sends messages; the list downloads for a WhatsApp or SMS tool.
import { useCallback, useEffect, useState } from 'react';
import { admin, ApiError } from '@/lib/client';
import { describeCode, usable, type Customer, type DiscountCode, type KioskSettings } from '@/lib/discounts';
import { Bar, dayLabel, inr, type Ctx } from './shared';

const SHOWN = 30; // customers listed on the phone; the CSV has all of them

export function Offers(p: Ctx) {
  const [data, setData] = useState<{ settings: KioskSettings; codes: DiscountCode[]; today: string } | null>(null);
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<DiscountCode | 'new' | null>(null);
  const failed = useCallback(
    (e: unknown, what: string) => {
      p.onAuthError(e);
      setErr(e instanceof ApiError ? e.message : what);
    },
    [p],
  );
  const { pin } = p;
  const load = useCallback(() => {
    admin
      .offers(pin)
      .then((d) => {
        setData(d);
        setErr(null);
      })
      .catch((e) => failed(e, 'Could not load offers. Check the internet.'));
    admin
      .customers(pin)
      .then(setCustomers)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `failed` changes every render; the PIN is what matters
  }, [pin]);
  useEffect(() => {
    load();
  }, [load]);

  const flip = async (k: keyof KioskSettings) => {
    if (!data) return;
    const next = !data.settings[k];
    setData({ ...data, settings: { ...data.settings, [k]: next } });
    try {
      await admin.saveSettings(pin, { [k]: next });
    } catch (e) {
      failed(e, 'Not saved: no internet.');
    }
    load();
  };
  const flipCode = async (c: DiscountCode) => {
    if (!data) return;
    setData({ ...data, codes: data.codes.map((x) => (x.code === c.code ? { ...x, active: !c.active } : x)) });
    try {
      await admin.saveCode(pin, { ...c, active: !c.active });
    } catch (e) {
      failed(e, 'Not saved: no internet.');
    }
    load();
  };

  const s = data?.settings;
  return (
    <section>
      <Bar
        right={
          <>
            <b>Offers</b>Codes and customers
          </>
        }
      />
      <div className="h1">Offers</div>
      {err && <div className="err pad">{err}</div>}
      {data && s && (
        <>
          <div className="mcat">
            <h3>On the kiosk</h3>
            {(
              [
                [
                  'codes',
                  'Discount code box',
                  'Customers can type a code in their order. Shows only while a code is on.',
                ],
                ['phone', 'Phone number box', 'Optional. The kiosk says it is for offers from Benne 14.'],
              ] as const
            ).map(([k, title, sub]) => (
              <div className="orow" key={k}>
                <div>
                  <b>{title}</b>
                  <small>{sub}</small>
                </div>
                <button
                  className={`sw ${s[k] ? '' : 'off'}`}
                  role="switch"
                  aria-checked={s[k]}
                  aria-label={title}
                  onClick={() => flip(k)}
                  data-testid={`set-${k}`}
                >
                  <span className="swlbl">{s[k] ? 'On' : 'Off'}</span>
                </button>
              </div>
            ))}
          </div>

          <div className="mcat">
            <h3>Discount codes</h3>
            {data.codes.length === 0 && <div className="none">No codes yet. Make one for an opening offer.</div>}
            {data.codes.map((c) => {
              const expired = !!c.expiresOn && c.expiresOn < data.today;
              return (
                <div
                  className={`orow ${usable(c, data.today) ? '' : 'dim'}`}
                  key={c.code}
                  data-testid={`code-${c.code}`}
                >
                  <button className="open" onClick={() => setEdit(c)}>
                    <b className="code">{c.code}</b>
                    <small>
                      {describeCode(c)}
                      {c.expiresOn
                        ? ` · ${expired ? 'ended' : 'until'} ${dayLabel(c.expiresOn, { day: 'numeric', month: 'short' })}`
                        : ''}
                    </small>
                  </button>
                  <button
                    className={`sw ${c.active ? '' : 'off'}`}
                    role="switch"
                    aria-checked={c.active}
                    aria-label={`Code ${c.code}`}
                    onClick={() => flipCode(c)}
                    data-testid={`code-sw-${c.code}`}
                  >
                    <span className="swlbl">{c.active ? 'On' : 'Off'}</span>
                  </button>
                </div>
              );
            })}
            <button className="btn y newcode" onClick={() => setEdit('new')} data-testid="new-code">
              New code
            </button>
          </div>

          <div className="mcat">
            <h3>Customers{customers?.length ? ` · ${customers.length}` : ''}</h3>
            <div className="was">
              Phone numbers customers typed at the kiosk, next to a line saying they are for offers from Benne 14. Paid
              orders only.
            </div>
            {customers && customers.length === 0 && <div className="none">No numbers yet.</div>}
            {(customers ?? []).slice(0, SHOWN).map((c) => (
              <div className="orow" key={c.phone} data-testid="customer">
                <div>
                  <b>{c.name ?? 'No name'}</b>
                  <small>
                    {c.phone.slice(0, 5)} {c.phone.slice(5)} · last{' '}
                    {dayLabel(c.lastOrderAt.slice(0, 10), { day: 'numeric', month: 'short' })}
                  </small>
                </div>
                <div className="r">
                  <b>{inr(c.spent)}</b>
                  <small>
                    {c.orders} {c.orders === 1 ? 'order' : 'orders'}
                  </small>
                </div>
              </div>
            ))}
            {customers && customers.length > SHOWN && (
              <div className="was">
                Showing the latest {SHOWN}. The download has all {customers.length}.
              </div>
            )}
          </div>
          {customers && customers.length > 0 && (
            <div className="dl">
              <button
                onClick={() => admin.download(pin, 'customers').catch((e) => failed(e, 'Download failed.'))}
                data-testid="dl-customers"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" />
                </svg>
                Customer list (CSV)
                <small>
                  {customers.length} {customers.length === 1 ? 'row' : 'rows'}
                </small>
              </button>
            </div>
          )}
        </>
      )}
      {edit && (
        <CodeSheet
          {...p}
          code={edit === 'new' ? null : edit}
          close={() => setEdit(null)}
          saved={() => {
            setEdit(null);
            load();
          }}
        />
      )}
    </section>
  );
}

function CodeSheet(p: Ctx & { code: DiscountCode | null; close: () => void; saved: () => void }) {
  const c = p.code;
  const [code, setCode] = useState(c?.code ?? '');
  const [kind, setKind] = useState<DiscountCode['kind']>(c?.kind ?? 'percent');
  const [value, setValue] = useState(c ? String(c.value) : '');
  const [minOrder, setMinOrder] = useState(c?.minOrder ? String(c.minOrder) : '');
  const [maxDiscount, setMaxDiscount] = useState(c?.maxDiscount ? String(c.maxDiscount) : '');
  const [expiresOn, setExpiresOn] = useState(c?.expiresOn ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const digits = (set: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) =>
    set(e.target.value.replace(/[^\d]/g, '').slice(0, 6));
  const num = (v: string) => (v === '' ? null : Number(v));
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await admin.saveCode(p.pin, {
        code,
        kind,
        value: Number(value),
        minOrder: num(minOrder),
        maxDiscount: kind === 'percent' ? num(maxDiscount) : null,
        expiresOn: expiresOn || null,
        active: c?.active ?? true,
      });
      p.saved();
    } catch (e) {
      p.onAuthError(e);
      setErr(e instanceof ApiError ? e.message : 'Not saved: no internet.');
      setBusy(false);
    }
  };
  return (
    <>
      <div className="scrim" onClick={p.close} />
      <div className="sheet" data-testid="code-sheet">
        <div className="grab" />
        <div className="hd">
          <div>
            <span className="eyebrow">{c ? 'Edit code' : 'New code'}</span>
            <div className="disp ttl">{code || 'Discount code'}</div>
          </div>
        </div>
        <div className="field">
          <label htmlFor="dc-code">Code customers type</label>
          <input
            id="dc-code"
            className="in"
            value={code}
            disabled={!!c}
            placeholder="WELCOME10"
            autoCapitalize="characters"
            onChange={(e) =>
              setCode(
                e.target.value
                  .toUpperCase()
                  .replace(/[^A-Z0-9]/g, '')
                  .slice(0, 16),
              )
            }
            data-testid="dc-code"
          />
          <div className="was">
            {c ? 'The code itself can’t be changed. Switch it off and make a new one.' : '3 to 16 letters and digits.'}
          </div>
        </div>
        <div className="field">
          <label>It takes off</label>
          <div className="range inset">
            <button
              className={kind === 'percent' ? 'on' : ''}
              onClick={() => setKind('percent')}
              data-testid="dc-percent"
            >
              Percent
            </button>
            <button className={kind === 'flat' ? 'on' : ''} onClick={() => setKind('flat')} data-testid="dc-flat">
              Rupees
            </button>
          </div>
        </div>
        <div className="field">
          <label htmlFor="dc-value">{kind === 'percent' ? 'Percent off' : 'Rupees off'}</label>
          <div className="money">
            <span>{kind === 'percent' ? '%' : '₹'}</span>
            <input
              id="dc-value"
              className="in"
              inputMode="numeric"
              value={value}
              onChange={digits(setValue)}
              data-testid="dc-value"
            />
          </div>
          <div className="was">Taken off the item total, before GST.</div>
        </div>
        <div className="field">
          <label htmlFor="dc-min">Minimum order{kind === 'flat' ? '' : ' (optional)'}</label>
          <div className="money">
            <span>₹</span>
            <input
              id="dc-min"
              className="in"
              inputMode="numeric"
              value={minOrder}
              onChange={digits(setMinOrder)}
              data-testid="dc-min"
            />
          </div>
        </div>
        {kind === 'percent' && (
          <div className="field">
            <label htmlFor="dc-max">Most it can take off (optional)</label>
            <div className="money">
              <span>₹</span>
              <input
                id="dc-max"
                className="in"
                inputMode="numeric"
                value={maxDiscount}
                onChange={digits(setMaxDiscount)}
                data-testid="dc-max"
              />
            </div>
          </div>
        )}
        <div className="field">
          <label htmlFor="dc-exp">Last day it works (optional)</label>
          <input
            id="dc-exp"
            className="in"
            type="date"
            value={expiresOn}
            onChange={(e) => setExpiresOn(e.target.value)}
            data-testid="dc-exp"
          />
        </div>
        {err && <div className="err">{err}</div>}
        <div className="actions">
          <button className="btn y" onClick={save} disabled={busy || !code || !value} data-testid="dc-save">
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button className="btn o" onClick={p.close}>
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}
