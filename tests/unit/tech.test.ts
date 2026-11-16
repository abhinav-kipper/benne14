import { describe, expect, it } from 'vitest';
import type { Order } from '@/lib/orders';
import type { ErrorEntry } from '@/lib/system';
import { groupErrors, moneyAndKitchen, reportText, speeds, type TechReport, type Timing } from '@/lib/tech';

const NOW = Date.parse('2026-11-16T10:00:00Z');
const at = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const t = (op: string, ms: number, ok = true, minAgo = 5): Timing => ({ op, ms, ok, build: 'v1', at: at(minAgo) });
const err = (message: string, minAgo: number, over: Partial<ErrorEntry> = {}): ErrorEntry => ({
  at: at(minAgo),
  source: 'server',
  message,
  detail: null,
  build: 'v1',
  device: null,
  ...over,
});
const order = (over: Partial<Order>): Order =>
  ({ id: 'x', status: 'new', createdAt: at(1), paidAt: at(1), readyAt: null, ...over }) as Order;

describe('speed', () => {
  it('gives the usual, the 95% and the worst time per step, and counts failures', () => {
    const times = [100, 120, 130, 140, 150, 160, 170, 180, 190, 4000].map((ms) => t('order.place', ms));
    const [s] = speeds([...times, t('order.place', 9000, false)], NOW);
    expect(s).toMatchObject({ op: 'order.place', name: 'Placing an order', count: 11, failed: 1 });
    expect(s.median).toBe(160);
    expect(s.p95).toBe(9000);
    expect(s.worst).toBe(9000);
  });

  it('leaves out anything older than a day and keeps steps apart', () => {
    const out = speeds([t('order.place', 100), t('pay.start', 800), t('order.place', 99_999, true, 25 * 60)], NOW);
    expect(out.map((s) => [s.op, s.count, s.worst])).toEqual([
      ['order.place', 1, 100],
      ['pay.start', 1, 800],
    ]);
  });

  it('says nothing when nothing was recorded', () => {
    expect(speeds([], NOW)).toEqual([]);
  });
});

describe('errors, grouped', () => {
  it('makes one line of the same message from the same place, most frequent first', () => {
    const groups = groupErrors([
      err('db timeout', 1, { detail: 'latest stack', build: 'v2' }),
      err('db timeout', 30),
      err('db timeout', 90),
      err('db timeout', 2, { source: 'kiosk' }), // same words, another place: its own line
      err('odd one', 3),
    ]);
    expect(groups.map((g) => [g.source, g.message, g.count])).toEqual([
      ['server', 'db timeout', 3],
      ['kiosk', 'db timeout', 1],
      ['server', 'odd one', 1],
    ]);
    expect(groups[0]).toMatchObject({ first: at(90), last: at(1), builds: ['v2', 'v1'], detail: 'latest stack' });
  });
});

describe('money and kitchen', () => {
  it('counts only payments that have waited too long, and says how long the oldest has', () => {
    const { money } = moneyAndKitchen(
      [
        order({ status: 'pending_payment', createdAt: at(2) }), // still fresh
        order({ status: 'pending_payment', createdAt: at(7) }),
        order({ status: 'awaiting_cash', createdAt: at(9) }), // the counter gets ten minutes
        order({ status: 'awaiting_cash', createdAt: at(14) }),
      ],
      [],
      NOW,
    );
    expect(money).toEqual({ upiOpen: 1, counterWaiting: 1, oldestMin: 14 });
  });

  it('counts the rail, the unstarted, and how long paid-to-ready takes', () => {
    const { kitchen } = moneyAndKitchen(
      [
        order({ status: 'new', paidAt: at(2) }),
        order({ status: 'new', paidAt: at(6) }), // nobody started it
        order({ status: 'cooking', paidAt: at(8) }),
        order({ status: 'ready' }),
      ],
      [
        order({ paidAt: at(30), readyAt: at(26) }), // 4 min
        order({ paidAt: at(50), readyAt: at(44) }), // 6 min
        order({ paidAt: at(90), readyAt: at(70) }), // 20 min
        order({ paidAt: at(5), readyAt: null }),
      ],
      NOW,
    );
    expect(kitchen).toEqual({ waiting: 3, unstarted: 1, readyMedianMin: 6, readyWorstMin: 20 });
  });

  it('has no kitchen pace before anything was ready', () => {
    expect(moneyAndKitchen([], [], NOW).kitchen).toMatchObject({ readyMedianMin: null, readyWorstMin: null });
  });
});

describe('the report to paste', () => {
  const report: TechReport = {
    now: at(0),
    build: 'abc1234',
    store: 'supabase',
    payments: 'easebuzz',
    testMode: false,
    migrations: { applied: 13, missing: ['0014_tech_page'] },
    speed: speeds([t('order.place', 420)], NOW),
    errors: groupErrors([err('db timeout', 1, { detail: 'Error: db timeout\n    at place (orders.ts:10)' })]),
    money: { upiOpen: 1, counterWaiting: 0, oldestMin: 7 },
    kitchen: { waiting: 2, unstarted: 0, readyMedianMin: 6, readyWorstMin: 20 },
    ordersToday: 41,
    devices: [
      { id: 'kiosk0000001', kind: 'kiosk', screen: 'home', build: 'abc1234', firstSeen: at(600), seenAt: at(0) },
    ],
    problems: [{ key: 'm', level: 'bad', text: 'A database update is waiting', hint: 'Run 0014' }],
    db: { bytes: 31_457_280, rows: { orders: 1200 }, firstOrder: '2026-11-01T03:00:00Z' },
  };

  it('holds every part in plain text', () => {
    const text = reportText(report);
    for (const part of [
      'build abc1234 · store supabase · payments easebuzz · test mode off',
      'MISSING 0014_tech_page',
      '[bad] A database update is waiting (Run 0014)',
      'kiosk kiosk0000001',
      'order.place: 1, 0 failed, 420 / 420 / 420',
      'ORDERS today 41',
      '1 UPI open over 5 min',
      'paid to ready median 6 min, worst 20 min',
      'x1 [server] db timeout',
      '| at place (orders.ts:10)',
      'DATABASE 30.0 MB',
      'orders: 1200 rows',
    ])
      expect(text).toContain(part);
  });

  it('reads sensibly when there is nothing to say', () => {
    const text = reportText({
      ...report,
      problems: [],
      devices: [],
      speed: [],
      errors: [],
      migrations: { applied: 14, missing: [] },
      db: { bytes: null, rows: {}, firstOrder: null },
    });
    expect(text).toContain('14 applied, none missing');
    expect(text).toContain('NEEDS A LOOK (0)\n- nothing');
    expect(text).toContain('- nothing recorded');
    expect(text).toContain('DATABASE in memory (no database)');
  });
});
