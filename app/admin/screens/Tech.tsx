'use client';
// The technical page, for whoever looks after the system (not for running the shop: that is the
// System page). Speed of the important steps, errors grouped, stuck money and kitchen pace, the
// database's size, and one button that copies all of it as text to paste into a chat. The numbers
// come from /api/admin/tech; the rules are in lib/tech.ts.
import { useCallback, useEffect, useState } from 'react';
import { admin, usePoll } from '@/lib/client';
import { ago } from '@/lib/system';
import { dbSize, reportText, SLOW_MS, type TechReport } from '@/lib/tech';
import { Bar, time, type Ctx } from './shared';

const secs = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

export function Tech({ pin, onAuthError, back }: Ctx & { back: () => void }) {
  const [r, setR] = useState<TechReport | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [copied, setCopied] = useState<'no' | 'yes' | 'shown'>('no');
  const load = useCallback(async () => {
    try {
      setR(await admin.tech(pin));
      setFailed(false);
    } catch (e) {
      onAuthError(e);
      setFailed(true);
      return false;
    }
  }, [pin, onAuthError]);
  usePoll(load, 30_000);
  useEffect(() => {
    if (copied !== 'yes') return;
    const t = setTimeout(() => setCopied('no'), 4000);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    if (!r) return;
    try {
      await navigator.clipboard.writeText(reportText(r));
      setCopied('yes');
    } catch {
      setCopied('shown'); // no clipboard here (old browser, not https): show the text to copy by hand
    }
  };
  const now = r ? Date.parse(r.now) : 0;
  const stuck = r ? r.money.upiOpen + r.money.counterWaiting : 0;

  return (
    <section data-testid="tech">
      <Bar
        right={
          <>
            <b>Technical</b>
            {r ? `Checked ${time(r.now)}` : 'Checking…'}
          </>
        }
      />
      <div className="h1">
        <button className="hback" onClick={back} aria-label="Back to System">
          ←
        </button>
        Technical
      </div>
      {!r && <div className="none pad">{failed ? 'Could not load. Trying again…' : 'Checking…'}</div>}
      {r && (
        <>
          <div className="mcat">
            <div className="actions">
              <button className="btn y" onClick={copy} data-testid="copy-report">
                {copied === 'yes' ? 'Copied' : 'Copy report'}
              </button>
            </div>
            <div className="was">
              Copies everything on this page as text, to paste into a chat when something needs fixing. No PINs, keys or
              customer details.
            </div>
            {copied === 'shown' && (
              <textarea className="reporttext" readOnly value={reportText(r)} data-testid="report-text" rows={12} />
            )}
          </div>

          <div className="mcat" data-testid="tech-speed">
            <h3>Speed, last 24 hours</h3>
            {r.speed.length === 0 && <div className="none">Nothing recorded yet.</div>}
            {r.speed.map((s) => (
              <div
                className={`dev ${s.failed || s.p95 >= SLOW_MS * 2 ? 'off' : 'on'}`}
                key={s.op}
                data-testid={`speed-${s.op}`}
              >
                <i />
                <div>
                  <b>{s.name}</b>
                  <span>
                    {s.count} {s.count === 1 ? 'time' : 'times'} · usually {secs(s.median)} · slowest {secs(s.worst)}
                    {s.failed ? ` · ${s.failed} failed` : ''}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="mcat" data-testid="tech-now">
            <h3>Right now</h3>
            <div className={`dev ${stuck ? 'off' : 'on'}`}>
              <i />
              <div>
                <b>Payments</b>
                <span>
                  {stuck === 0
                    ? 'None waiting too long'
                    : `${r.money.upiOpen} UPI open, ${r.money.counterWaiting} at the counter · oldest ${r.money.oldestMin} min`}
                </span>
              </div>
            </div>
            <div className={`dev ${r.kitchen.unstarted ? 'off' : 'on'}`}>
              <i />
              <div>
                <b>Kitchen</b>
                <span>
                  {r.kitchen.waiting} on the rail
                  {r.kitchen.unstarted ? ` · ${r.kitchen.unstarted} not started` : ''}
                  {r.kitchen.readyMedianMin != null
                    ? ` · paid to ready usually ${r.kitchen.readyMedianMin} min, longest ${r.kitchen.readyWorstMin} min`
                    : ''}
                </span>
              </div>
            </div>
            <div className="dev on">
              <i />
              <div>
                <b>Orders today</b>
                <span>{r.ordersToday}</span>
              </div>
            </div>
          </div>

          <div className="mcat" data-testid="tech-errors">
            <h3>Errors, grouped</h3>
            {r.errors.length === 0 && <div className="none">Nothing has gone wrong.</div>}
            {r.errors.map((e, n) => (
              <button
                className={`errrow ${open === n ? 'open' : ''}`}
                key={n}
                onClick={() => setOpen(open === n ? null : n)}
                data-testid="errgroup"
              >
                <span className="when">
                  {e.count} {e.count === 1 ? 'time' : 'times'}
                  <small>{ago(e.last, now)}</small>
                </span>
                <span className="what">
                  {e.message}
                  {open === n && (
                    <code>
                      {`from ${e.source} · first ${ago(e.first, now)} · version ${e.builds.map((b) => b.slice(0, 7)).join(', ') || '-'}`}
                      {e.detail ? `\n${e.detail}` : ''}
                    </code>
                  )}
                </span>
              </button>
            ))}
          </div>

          <div className="mcat" data-testid="tech-db">
            <h3>Database</h3>
            <div className={`dev ${r.migrations.missing.length ? 'off' : 'on'}`}>
              <i />
              <div>
                <b>{dbSize(r.db)}</b>
                <span>
                  {r.migrations.missing.length
                    ? `Updates still to run: ${r.migrations.missing.join(', ')}`
                    : `All ${r.migrations.applied} updates run`}
                  {Object.keys(r.db.rows).length
                    ? ` · ${Object.entries(r.db.rows)
                        .map(([t, n]) => `${t} ${n}`)
                        .join(', ')}`
                    : ''}
                </span>
              </div>
            </div>
          </div>

          <div className="sysfoot">
            Version {r.build.slice(0, 7)} · store {r.store} · payments {r.payments} · test mode{' '}
            {r.testMode ? 'on' : 'off'}
          </div>
        </>
      )}
    </section>
  );
}
