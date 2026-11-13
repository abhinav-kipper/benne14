'use client';
// Change history: menu edits and refunds, newest first.
import { useEffect, useState } from 'react';
import { admin } from '@/lib/client';
import { addDays, istDay, type AdminEvent } from '@/lib/orders';
import { Bar, dayLabel, time, type Ctx } from './shared';

export function History(p: Ctx & { back: () => void }) {
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
