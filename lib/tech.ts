// The owner app's technical page: how fast the important steps are, which errors keep happening,
// whether money or the kitchen is stuck, and how big the database is. Pure, so it can be tested
// without a clock or a database. The plain-language page for the shop is lib/system.ts.
import { minutesSince, type Order } from './orders';
import type { Device, ErrorEntry, Problem } from './system';

export interface Timing {
  at: string;
  op: string; // 'order.place', 'order.move', 'pay.start', 'pay.check', or 'slow.<route>'
  ms: number;
  ok: boolean;
  build: string | null;
}
export interface DbStats {
  bytes: number | null; // null on the in-memory store
  rows: Record<string, number>;
  firstOrder: string | null;
}

export const OP_NAME: Record<string, string> = {
  'order.place': 'Placing an order',
  'order.move': 'Kitchen tap (start, ready, handed over, paid)',
  'pay.start': 'Easebuzz: starting a payment',
  'pay.check': 'Easebuzz: checking a payment (slow or failed only)',
  'orders.list': 'Loading the live orders (slow only)',
};
export const SLOW_MS = 1500; // a step slower than this is worth a row even when it is not always recorded
const STUCK_PAY_MIN = 5; // a UPI payment still open after this long
const STUCK_COUNTER_MIN = 10; // a card or cash order nobody has confirmed
const UNSTARTED_MIN = 5; // a paid order nobody has started cooking

export interface Speed {
  op: string;
  name: string;
  count: number;
  failed: number;
  median: number;
  p95: number;
  worst: number;
}
export interface ErrorGroup {
  message: string;
  source: string;
  count: number;
  first: string;
  last: string;
  builds: string[];
  detail: string | null; // from the latest one
}
export interface TechReport {
  now: string;
  build: string;
  store: string;
  payments: string;
  testMode: boolean;
  migrations: { applied: number; missing: string[] };
  speed: Speed[]; // last 24 hours
  errors: ErrorGroup[]; // most frequent first
  money: { upiOpen: number; counterWaiting: number; oldestMin: number };
  kitchen: { waiting: number; unstarted: number; readyMedianMin: number | null; readyWorstMin: number | null };
  ordersToday: number;
  devices: Device[];
  problems: Problem[];
  db: DbStats;
}

const pick = (sorted: number[], q: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0;

export function speeds(timings: Timing[], now: number, hours = 24): Speed[] {
  const since = now - hours * 3600_000;
  const by = new Map<string, Timing[]>();
  for (const t of timings) if (Date.parse(t.at) >= since) by.set(t.op, [...(by.get(t.op) ?? []), t]);
  return [...by.entries()]
    .map(([op, list]) => {
      const ms = list.map((t) => t.ms).sort((a, b) => a - b);
      return {
        op,
        name: OP_NAME[op] ?? op,
        count: list.length,
        failed: list.filter((t) => !t.ok).length,
        median: pick(ms, 0.5),
        p95: pick(ms, 0.95),
        worst: ms[ms.length - 1],
      };
    })
    .sort((a, b) => a.op.localeCompare(b.op));
}

// The same message from the same place is one line with a count, not two hundred lines.
export function groupErrors(errors: ErrorEntry[]): ErrorGroup[] {
  const by = new Map<string, ErrorGroup>();
  for (const e of errors) {
    const key = `${e.source}\n${e.message}`;
    const g = by.get(key);
    if (!g) {
      by.set(key, {
        message: e.message,
        source: e.source,
        count: 1,
        first: e.at,
        last: e.at,
        builds: e.build ? [e.build] : [],
        detail: e.detail,
      });
      continue;
    }
    g.count++;
    if (e.at < g.first) g.first = e.at;
    if (e.at > g.last) {
      g.last = e.at;
      g.detail = e.detail ?? g.detail;
    }
    if (e.build && !g.builds.includes(e.build)) g.builds.push(e.build);
  }
  return [...by.values()].sort((a, b) => b.count - a.count || b.last.localeCompare(a.last));
}

export function moneyAndKitchen(live: Order[], today: Order[], now: number) {
  const age = (o: Order) => minutesSince(o.createdAt, now);
  const upiOpen = live.filter((o) => o.status === 'pending_payment' && age(o) >= STUCK_PAY_MIN);
  const counter = live.filter((o) => o.status === 'awaiting_cash' && age(o) >= STUCK_COUNTER_MIN);
  const waiting = live.filter((o) => o.status === 'new' || o.status === 'cooking');
  const took = today
    .filter((o) => o.readyAt && o.paidAt)
    .map((o) => Math.max(0, Math.round((Date.parse(o.readyAt!) - Date.parse(o.paidAt!)) / 60_000)))
    .sort((a, b) => a - b);
  return {
    money: {
      upiOpen: upiOpen.length,
      counterWaiting: counter.length,
      oldestMin: Math.max(0, ...[...upiOpen, ...counter].map(age)),
    },
    kitchen: {
      waiting: waiting.length,
      unstarted: waiting.filter(
        (o) => o.status === 'new' && minutesSince(o.paidAt ?? o.createdAt, now) >= UNSTARTED_MIN,
      ).length,
      readyMedianMin: took.length ? pick(took, 0.5) : null,
      readyWorstMin: took.length ? took[took.length - 1] : null,
    },
  };
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
export const dbSize = (db: DbStats) => (db.bytes == null ? 'in memory (no database)' : mb(db.bytes));

// The whole report as plain text, to paste into a chat when something needs fixing. No secrets and
// no customer details: versions, settings as on/off, counts, timings and error messages.
export function reportText(r: TechReport): string {
  const out: string[] = [];
  const line = (s = '') => out.push(s);
  line(`Benne 14 technical report · ${r.now}`);
  line(`build ${r.build} · store ${r.store} · payments ${r.payments} · test mode ${r.testMode ? 'on' : 'off'}`);
  line(
    `migrations: ${r.migrations.applied} applied${r.migrations.missing.length ? `, MISSING ${r.migrations.missing.join(', ')}` : ', none missing'}`,
  );
  line();
  line(`NEEDS A LOOK (${r.problems.length})`);
  for (const p of r.problems) line(`- [${p.level}] ${p.text}${p.hint ? ` (${p.hint})` : ''}`);
  if (!r.problems.length) line('- nothing');
  line();
  line('SCREENS');
  for (const d of r.devices)
    line(
      `- ${d.kind}${d.shop ? ' (the shop’s)' : ''} ${d.id}: last heard ${d.seenAt}, showing ${d.screen ?? '-'}, build ${d.build ?? '-'}`,
    );
  if (!r.devices.length) line('- none seen');
  line();
  line('SPEED, last 24 h (count, failed, median / 95% / worst in ms)');
  for (const s of r.speed) line(`- ${s.op}: ${s.count}, ${s.failed} failed, ${s.median} / ${s.p95} / ${s.worst}`);
  if (!r.speed.length) line('- nothing recorded');
  line();
  line(`ORDERS today ${r.ordersToday}`);
  line(
    `money: ${r.money.upiOpen} UPI open over ${STUCK_PAY_MIN} min, ${r.money.counterWaiting} at the counter over ${STUCK_COUNTER_MIN} min, oldest ${r.money.oldestMin} min`,
  );
  line(
    `kitchen: ${r.kitchen.waiting} on the rail, ${r.kitchen.unstarted} unstarted over ${UNSTARTED_MIN} min, paid to ready median ${r.kitchen.readyMedianMin ?? '-'} min, worst ${r.kitchen.readyWorstMin ?? '-'} min`,
  );
  line();
  line(`ERRORS (${r.errors.length} kinds)`);
  for (const e of r.errors) {
    line(`- x${e.count} [${e.source}] ${e.message}`);
    line(`  first ${e.first}, last ${e.last}, builds ${e.builds.join(', ') || '-'}`);
    if (e.detail) for (const l of e.detail.split('\n').slice(0, 6)) line(`  | ${l.trim()}`);
  }
  if (!r.errors.length) line('- none');
  line();
  line(`DATABASE ${dbSize(r.db)}${r.db.firstOrder ? ` · first order ${r.db.firstOrder}` : ''}`);
  for (const [t, n] of Object.entries(r.db.rows)) line(`- ${t}: ${n} rows`);
  return out.join('\n');
}
