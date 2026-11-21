import { expect, test, type APIRequestContext } from '@playwright/test';
import { makeKioskKey } from '../../lib/kioskkey';

// A lunch rush and a long shift, on a server of their own. Not about what the app does (the other
// suites cover that) but about whether it keeps doing it: 150 orders in a burst while the kitchen,
// the TV and the owner's phone keep asking for the list, and a kitchen screen that has been open
// through hundreds of orders. The time limits are generous on purpose: they catch "ten times
// slower", not a slow test machine.
const PIN = '2468';
const P = { 'x-staff-pin': PIN };
// More than one tablet: each may place 120 orders a minute (lib/kioskkey.ts), as in the shop.
const TABLETS = ['rushtablet01', 'rushtablet02', 'rushtablet03', 'rushtablet04'].map((id) => ({
  'x-kiosk-key': makeKioskKey(PIN, '', id),
}));

test.beforeAll(async ({ request }) => {
  const h = await (await request.get('/api/health')).json();
  if (h.store !== 'memory') throw new Error(`Refusing to run e2e against the ${h.store} store`);
});
test.describe.configure({ mode: 'serial' });

const DISHES = ['masala-dosa', 'plain-dosa', 'mallige-idli', 'medu-vada', 'filter-coffee'];
let seq = 0;
async function place(r: APIRequestContext, payMethod: 'cash' | 'card' = 'cash') {
  const n = seq++;
  const start = Date.now();
  const res = await r.post('/api/orders', {
    headers: TABLETS[n % TABLETS.length],
    data: {
      key: `rush-order-${n}-${start}`,
      type: n % 2 ? 'dine_in' : 'takeaway',
      name: null,
      payMethod,
      lines: [
        { itemId: DISHES[n % DISHES.length], qty: 1 + (n % 3), choices: {}, notes: [] },
        { itemId: DISHES[(n + 2) % DISHES.length], qty: 1, choices: {}, notes: [] },
      ],
    },
  });
  return { status: res.status(), ms: Date.now() - start, order: res.ok() ? await res.json() : null };
}
const move = (r: APIRequestContext, id: string, to: string) =>
  r.post(`/api/orders/${id}/status`, { data: { to }, headers: P });
// run `jobs` with at most `width` at once, the way a queue at the counter arrives
async function pool<T>(jobs: (() => Promise<T>)[], width: number): Promise<T[]> {
  const out: T[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: width }, async () => {
      while (next < jobs.length) {
        const mine = next++;
        out[mine] = await jobs[mine]();
      }
    }),
  );
  return out;
}
const pct = (list: number[], q: number) => [...list].sort((a, b) => a - b)[Math.floor(q * (list.length - 1))];

test('lunch rush: 150 orders in a burst, every one numbered once, while three screens keep polling', async ({
  request,
}) => {
  test.setTimeout(180_000);
  const before = ((await (await request.get('/api/orders?view=today')).json()) as unknown[]).length;

  // the kitchen, the TV and the owner's phone asking all through the rush
  let rushing = true;
  const polls: { ms: number; ok: boolean }[] = [];
  const poller = async (path: string, every: number) => {
    while (rushing) {
      const start = Date.now();
      const res = await request.get(path).catch(() => null);
      polls.push({ ms: Date.now() - start, ok: !!res?.ok() });
      await new Promise((r) => setTimeout(r, every));
    }
  };
  // (asked far more often than the real 1.5 s, so the short burst is polled all the way through)
  const screens = [
    poller('/api/orders', 150),
    poller('/api/orders', 150),
    poller('/api/orders?view=collected', 150),
    poller('/api/orders?view=today', 500),
  ];

  const N = 150;
  const placed = await pool(
    Array.from({ length: N }, () => () => place(request)),
    10,
  );
  expect(
    placed.filter((p) => p.status !== 201).map((p) => p.status),
    'every order was accepted',
  ).toEqual([]);
  const tokens = placed.map((p) => +p.order.token).sort((a, b) => a - b);
  expect(tokens, 'numbers are in one unbroken run, none twice, none skipped').toEqual(
    Array.from({ length: N }, (_, i) => before + i + 1),
  );
  expect(new Set(placed.map((p) => p.order.id)).size).toBe(N);

  // the counter takes the money, the kitchen cooks: every order moves on, ten taps at a time
  const taps: number[] = [];
  const tap = async (id: string, to: string) => {
    const start = Date.now();
    const res = await move(request, id, to);
    taps.push(Date.now() - start);
    return res.status();
  };
  for (const to of ['new', 'cooking']) {
    const statuses = await pool(
      placed.map((p) => () => tap(p.order.id, to)),
      10,
    );
    expect(
      statuses.filter((s) => s !== 200),
      `every order moved to ${to}`,
    ).toEqual([]);
  }
  rushing = false;
  await Promise.all(screens);

  const live = (await (await request.get('/api/orders')).json()) as { status: string }[];
  expect(live.filter((o) => o.status === 'cooking').length).toBe(N);

  const orderMs = placed.map((p) => p.ms);
  const pollMs = polls.map((p) => p.ms);
  console.log(
    `rush: order median ${pct(orderMs, 0.5)} ms, 95% ${pct(orderMs, 0.95)} ms, worst ${Math.max(...orderMs)} ms · ` +
      `tap 95% ${pct(taps, 0.95)} ms · ${polls.length} polls, 95% ${pct(pollMs, 0.95)} ms, worst ${Math.max(...pollMs)} ms`,
  );
  expect(
    polls.filter((p) => !p.ok),
    'no screen was refused or failed while the rush was on',
  ).toEqual([]);
  expect(pct(orderMs, 0.95), 'placing an order stays quick').toBeLessThan(2000);
  expect(pct(taps, 0.95), 'kitchen taps stay quick').toBeLessThan(2000);
  expect(pct(pollMs, 0.95), 'the screens’ list stays quick').toBeLessThan(2000);

  // clear the rail for the next test
  for (const to of ['ready', 'handed_over'])
    await pool(
      placed.map((p) => () => move(request, p.order.id, to)),
      10,
    );
});

test('long shift: a kitchen screen open through 240 more orders stays as light and as quick as at the start', async ({
  browser,
  request,
}) => {
  test.setTimeout(300_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript((pin) => localStorage.setItem('benne14.staffPin', pin), PIN);
  const page = await ctx.newPage();
  await page.goto('/kitchen');
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  const measure = async () => {
    // more than once: elements taken off the page are only let go a collection or two later
    for (let n = 0; n < 3; n++) await cdp.send('HeapProfiler.collectGarbage');
    const { metrics } = await cdp.send('Performance.getMetrics');
    const get = (name: string) => metrics.find((m) => m.name === name)!.value;
    return {
      heapMb: get('JSHeapUsedSize') / 1024 / 1024,
      onPage: await page.evaluate(() => document.querySelectorAll('*').length), // what the screen has to draw
      nodes: get('Nodes'), // those, plus any taken off the page but still held in memory
      listeners: get('JSEventListeners'),
    };
  };

  // one round: 20 orders arrive and are paid, cooked, called and collected, with the screen watching
  const round = async () => {
    const batch = await pool(
      Array.from({ length: 20 }, () => () => place(request)),
      5,
    );
    expect(batch.every((b) => b.status === 201)).toBe(true);
    await pool(
      batch.map((b) => () => move(request, b.order.id, 'new')),
      5,
    );
    await expect(page.locator('.chit')).toHaveCount(20, { timeout: 15_000 });
    for (const to of ['cooking', 'ready'])
      await pool(
        batch.map((b) => () => move(request, b.order.id, to)),
        5,
      );
    await expect(page.locator('[data-testid^="ready-"]')).toHaveCount(20, { timeout: 15_000 });
    await pool(
      batch.map((b) => () => move(request, b.order.id, 'handed_over')),
      5,
    );
    await expect(page.locator('[data-testid^="ready-"]')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator('.chit')).toHaveCount(0);
  };

  await round(); // warm up: fonts, photos, first renders
  await round();
  const early = await measure();
  for (let n = 0; n < 10; n++) await round();
  const late = await measure();
  console.log(
    `shift: heap ${early.heapMb.toFixed(1)} → ${late.heapMb.toFixed(1)} MB, on the page ${early.onPage} → ${late.onPage}, held in memory ${early.nodes} → ${late.nodes}, listeners ${early.listeners} → ${late.listeners}`,
  );
  expect(late.onPage, 'the page shows no more elements than at the start').toBeLessThanOrEqual(early.onPage + 10);
  // The browser may still be holding the last round's elements (about a thousand) when this is read.
  // A leak keeps every round's: ten rounds would be ten thousand.
  expect(late.nodes, 'elements of old orders are let go, not kept round after round').toBeLessThanOrEqual(
    early.nodes + 2500,
  );
  expect(late.listeners, 'nothing keeps listening after its order has gone').toBeLessThanOrEqual(
    early.listeners * 1.2 + 20,
  );
  expect(late.heapMb - early.heapMb, 'memory has not crept up').toBeLessThan(15);

  // and it still answers a tap at once
  const last = await place(request);
  await move(request, last.order.id, 'new');
  const chit = page.getByTestId(`chit-${last.order.token}`);
  await expect(chit).toBeVisible({ timeout: 10_000 });
  const start = Date.now();
  await chit.getByRole('button', { name: /start/i }).click();
  await expect(chit).toHaveClass(/cooking/);
  expect(Date.now() - start, 'a tap on the last order of the shift').toBeLessThan(1500);
  await ctx.close();
});
