'use client';
// Is everything in the shop working? Every screen and when it was last heard from, what needs a
// look, and the latest errors. The numbers come from /api/admin/system; the rules are in lib/system.ts.
import { useState } from 'react';
import type { SystemReport } from '@/lib/client';
import { ago, isOnline, kindName, type DeviceKind } from '@/lib/system';
import { Bar, time } from './shared';

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

export function System({ sys, back }: { sys: SystemReport | null; back: () => void }) {
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

          <div className="mcat">
            <h3>Screens</h3>
            {SHOP_SCREENS.map((kind) => {
              const mine = sys.devices.filter((d) => d.kind === kind);
              if (!mine.length)
                return (
                  <div className="dev none-yet" key={kind} data-testid={`dev-${kind}`}>
                    <i />
                    <div>
                      <b>{kindName(kind)}</b>
                      <span>Not connected yet. It appears here once that screen is opened.</span>
                    </div>
                  </div>
                );
              return mine.map((d, n) => {
                const on = isOnline(d, now);
                return (
                  <div className={`dev ${on ? 'on' : 'off'}`} key={d.id} data-testid={`dev-${kind}`}>
                    <i />
                    <div>
                      <b>
                        {kindName(kind)}
                        {mine.length > 1 ? ` ${n + 1}` : ''}
                      </b>
                      <span>
                        {on
                          ? `Online${d.screen && SHOWING[d.screen] ? ` · ${SHOWING[d.screen]}` : ''}`
                          : `Silent · last heard ${ago(d.seenAt, now)}`}
                        {on && d.build && d.build !== sys.build ? ' · old version' : ''}
                      </span>
                    </div>
                  </div>
                );
              });
            })}
            <div className="was">
              A screen counts as silent after two minutes without a word: it is off, asleep or has lost Wi-Fi.
            </div>
          </div>

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
            {sys.payments === 'easebuzz' ? 'Easebuzz' : sys.payments === 'mock' ? 'test payments' : 'the shop’s own QR'}
          </div>
        </>
      )}
    </section>
  );
}
