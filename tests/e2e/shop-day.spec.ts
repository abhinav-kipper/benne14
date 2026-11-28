import { expect, test, type APIRequestContext } from '@playwright/test';

// One whole day at the shop, on a server of its own: forty mixed orders through every path a real
// day takes (dine in and takeaway, UPI, card and cash, extras, a discount code, walk-aways,
// refunds, orders still cooking at the end). Then every place that shows the day's numbers must
// agree with every other: the bills, the owner's dashboard, the three CSV downloads, the kitchen,
// the TV, the phone bill and the technical page. Each feature has its own tests elsewhere; this
// one is for the seams between them.
const OWNER = '246810';
const H = { 'x-staff-pin': OWNER };
const DAY = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

test.beforeAll(async ({ request }) => {
  const h = await (await request.get('/api/health')).json();
  if (h.store !== 'memory') throw new Error(`Refusing to run e2e against the ${h.store} store`);
});
test.describe.configure({ mode: 'serial' });

interface Bill {
  id: string;
  token: string;
  status: string;
  payMethod: 'upi' | 'card' | 'cash';
  type: string;
  lines: { name: string; qty: number; lineTotal?: number }[];
  itemCount: number;
  subtotal: number;
  cgst: number;
  sgst: number;
  roundOff: number;
  total: number;
  savings: number;
  discountCode: string | null;
  refundedAt: string | null;
  refundAmount: number | null;
}
type Fate = 'walked' | 'refunded' | 'new' | 'cooking' | 'ready' | 'collected';
interface Plan {
  n: number;
  lines: { itemId: string; qty: number; choices: Record<string, string[]>; notes: string[] }[];
  payMethod: 'upi' | 'card' | 'cash';
  type: 'dine_in' | 'takeaway';
  code: string | null;
  fate: Fate;
  listPrice: number; // what the menu says, worked out here and not by the app
  pack: number; // packaging on a takeaway: ₹15 a dish, ₹5 a coffee or tea
}

// The menu's prices, written out again on purpose: the test must not trust the app's own sums.
const PRICE: Record<string, number> = {
  'masala-dosa': 209,
  'ghee-podi-benne-dosa': 199,
  'plain-benne-dosa': 159,
  'plain-dosa': 169,
  'mallige-idli': 89,
  'thatte-idli': 89,
  'medu-vada': 89,
  'filter-coffee': 69,
  'masala-tea': 49,
};
const EXTRA: Record<string, number> = { benne: 25, podi: 15, palya: 30, sambar: 20, ghee: 15 };
const DISHES = Object.keys(PRICE);
const DOSA = new Set(['masala-dosa', 'ghee-podi-benne-dosa', 'plain-benne-dosa', 'plain-dosa']);
const DRINK = new Set(['filter-coffee', 'masala-tea']);

function plan(): Plan[] {
  const out: Plan[] = [];
  for (let n = 1; n <= 40; n++) {
    const lines: Plan['lines'] = [];
    let listPrice = 0;
    let packed = 0;
    for (let j = 0; j < 1 + (n % 3); j++) {
      const itemId = DISHES[(n * 3 + j * 5) % DISHES.length];
      const qty = 1 + ((n + j) % 3);
      const extras = DRINK.has(itemId)
        ? []
        : (n + j) % 4 === 0
          ? DOSA.has(itemId)
            ? ['benne', 'podi']
            : ['ghee']
          : (n + j) % 5 === 0
            ? ['sambar']
            : [];
      const group = DRINK.has(itemId) ? 'sugar' : DOSA.has(itemId) ? 'dosaExtras' : 'idliExtras';
      lines.push({
        itemId,
        qty,
        choices: DRINK.has(itemId)
          ? { [group]: [n % 2 ? 'less' : 'regular'] }
          : extras.length
            ? { [group]: extras }
            : {},
        notes: itemId === 'masala-dosa' && n % 2 ? ['potato-side'] : [],
      });
      listPrice += qty * (PRICE[itemId] + extras.reduce((a, x) => a + EXTRA[x], 0));
      packed += qty * (DRINK.has(itemId) ? 5 : 15);
    }
    const fate: Fate =
      n % 10 === 0
        ? 'walked'
        : n % 13 === 0
          ? 'refunded'
          : n === 37
            ? 'ready'
            : n === 38
              ? 'cooking'
              : n === 36
                ? 'new'
                : 'collected';
    out.push({
      n,
      lines,
      listPrice,
      pack: n % 2 ? 0 : packed,
      payMethod: (['upi', 'card', 'cash'] as const)[n % 3],
      type: n % 2 ? 'dine_in' : 'takeaway',
      code: n % 7 === 0 ? 'DAY10' : null,
      fate,
    });
  }
  return out;
}

const PLAN = plan();
const bills: Bill[] = [];
const ids: string[] = [];
const sum = <T>(list: T[], f: (b: T) => number) => list.reduce((a, b) => a + f(b), 0);
const paid = () => bills.filter((b) => !['pending_payment', 'awaiting_cash', 'cancelled'].includes(b.status));
const kept = () => paid().filter((b) => !b.refundedAt);
const csv = async (r: APIRequestContext, kind: string) => {
  const res = await r.get(`/api/admin/export?kind=${kind}&from=${DAY()}&to=${DAY()}`, { headers: H });
  expect(res.status()).toBe(200);
  return (await res.text())
    .replace(/^﻿/, '')
    .trim()
    .split('\r\n')
    .map((row) => row.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '')));
};

test('forty orders go through every path of a day, each with the right number and the right money', async ({
  request,
}) => {
  test.setTimeout(120_000);
  expect(
    (
      await request.post('/api/admin/offers', {
        data: { code: { code: 'DAY10', kind: 'percent', value: 10 } },
        headers: H,
      })
    ).status(),
  ).toBe(200);
  const move = async (id: string, to: string) =>
    expect((await request.post(`/api/orders/${id}/status`, { data: { to }, headers: H })).status(), `${to}`).toBe(200);

  for (const p of PLAN) {
    const res = await request.post('/api/orders', {
      data: {
        key: `shop-day-order-${p.n}`,
        type: p.type,
        name: p.n % 4 === 0 ? `Guest ${p.n}` : null,
        payMethod: p.payMethod,
        lines: p.lines,
        code: p.code,
        phone: p.code ? `98765${String(10000 + p.n)}` : null,
      },
    });
    expect(res.status(), `order ${p.n}: ${await res.text()}`).toBe(201);
    const o = (await res.json()) as Bill;
    ids.push(o.id);
    expect(o.token, 'numbers run 1, 2, 3… with none skipped').toBe(String(p.n));

    // the money, worked out here: menu price, 10% off with the code, 5% GST to the paisa, the total to the rupee
    const off = p.code ? o.savings : 0;
    if (p.code) expect(Math.abs(off - p.listPrice * 0.1), `order ${p.n} discount`).toBeLessThanOrEqual(1);
    else expect(o.savings).toBe(0);
    expect(o.subtotal, `order ${p.n} before GST`).toBe(p.listPrice - off + p.pack);
    const paise = (x: number) => Math.round(x * 100);
    expect(Math.abs(paise(o.cgst + o.sgst) - paise(o.subtotal * 0.05)), `order ${p.n} GST`).toBeLessThanOrEqual(1);
    expect(Math.abs(paise(o.roundOff)), `order ${p.n} round off`).toBeLessThanOrEqual(50);
    expect(o.total * 100, `order ${p.n} adds up`).toBe(paise(o.subtotal + o.cgst + o.sgst + o.roundOff));
    expect(Number.isInteger(o.total)).toBe(true);
    expect(o.itemCount).toBe(p.lines.reduce((a, l) => a + l.qty, 0));

    if (p.fate === 'walked') {
      if (p.payMethod === 'upi')
        expect((await request.post(`/api/orders/${o.id}/claim`, { data: { action: 'cancel' } })).status()).toBe(200);
      else await move(o.id, 'cancelled');
      continue;
    }
    // paid: UPI by the (mock) payment, card and cash by staff at the counter
    if (p.payMethod === 'upi') expect((await request.post(`/api/orders/${o.id}/pay`)).status()).toBe(200);
    else await move(o.id, 'new');
    if (p.fate === 'new') continue;
    await move(o.id, 'cooking');
    if (p.fate === 'cooking') continue;
    await move(o.id, 'ready');
    if (p.fate === 'ready') continue;
    await move(o.id, 'handed_over');
    if (p.fate === 'refunded')
      expect(
        (
          await request.post(`/api/admin/orders/${o.id}/refund`, { data: { reason: 'Food issue' }, headers: H })
        ).status(),
      ).toBe(200);
  }

  for (const p of PLAN) {
    const again = await byKey(request, p.n); // every order is sent a second time
    expect(again.id, `order ${p.n} sent twice is still one order`).toBe(ids[p.n - 1]);
    bills.push(await (await request.get(`/api/orders/${again.id}`)).json());
  }
  const want: Record<Fate, string> = {
    walked: 'cancelled',
    refunded: 'handed_over',
    new: 'new',
    cooking: 'cooking',
    ready: 'ready',
    collected: 'handed_over',
  };
  expect(bills.map((b) => b.status)).toEqual(PLAN.map((p) => want[p.fate]));
  expect(bills.filter((b) => b.refundedAt).map((b) => b.token)).toEqual(['13', '26', '39']);
  expect(new Set(bills.map((b) => b.token)).size).toBe(40);
});

// The same checkout key and cart again (a retry on a bad connection) hands back the order already saved.
async function byKey(request: APIRequestContext, n: number): Promise<Bill> {
  const p = PLAN[n - 1];
  const res = await request.post('/api/orders', {
    data: {
      key: `shop-day-order-${p.n}`,
      type: p.type,
      name: p.n % 4 === 0 ? `Guest ${p.n}` : null,
      payMethod: p.payMethod,
      lines: p.lines,
      code: p.code,
      phone: p.code ? `98765${String(10000 + p.n)}` : null,
    },
  });
  expect(res.ok(), `retry of order ${n}`).toBe(true);
  return res.json();
}

test('placing an order twice never made a second one', async ({ request }) => {
  const today = (await (await request.get('/api/orders?view=today')).json()) as Bill[];
  expect(today).toHaveLength(40);
  expect(today.map((o) => +o.token).sort((a, b) => a - b)).toEqual(PLAN.map((p) => p.n));
});

test('the dashboard’s numbers are the bills added up', async ({ request }) => {
  const r = (await (await request.get(`/api/admin/report?from=${DAY()}&to=${DAY()}`, { headers: H })).json()).current;
  const k = kept();
  expect(k.length).toBe(40 - 4 - 3); // four walked away, three were refunded
  expect(r.orders).toBe(k.length);
  expect(r.takings).toBe(sum(k, (b) => b.total));
  for (const m of ['upi', 'card', 'cash'] as const)
    expect(r.split[m], `${m} takings`).toBe(
      sum(
        k.filter((b) => b.payMethod === m),
        (b) => b.total,
      ),
    );
  expect(r.split.upi + r.split.card + r.split.cash).toBe(r.takings);
  const refunded = bills.filter((b) => b.refundedAt);
  expect(r.refunds).toEqual({ count: 3, amount: sum(refunded, (b) => b.refundAmount ?? 0) });
  expect(sum(refunded, (b) => b.refundAmount ?? 0)).toBe(sum(refunded, (b) => b.total));
  const coded = k.filter((b) => b.discountCode);
  expect(r.discounts).toEqual({ count: coded.length, amount: sum(coded, (b) => b.savings) });
  expect(r.gst.total).toBe(r.takings);
  expect(r.gst.taxable).toBe(sum(k, (b) => b.subtotal));
  expect(Math.round((r.gst.cgst + r.gst.sgst) * 100)).toBe(Math.round(sum(k, (b) => b.cgst + b.sgst) * 100));
  expect(Math.round((r.gst.taxable + r.gst.cgst + r.gst.sgst + r.gst.roundOff) * 100)).toBe(r.takings * 100);
  expect(sum(r.dishes as { qty: number }[], (d) => d.qty)).toBe(sum(k, (b) => b.itemCount));
  expect(r.days).toEqual([{ day: DAY(), takings: r.takings, orders: r.orders }]);
  expect(sum(r.hours as { orders: number }[], (h) => h.orders)).toBe(r.orders);
});

test('the three CSV downloads say the same as the dashboard', async ({ request }) => {
  const k = kept();
  const takings = sum(k, (b) => b.total);

  const [head, ...rows] = await csv(request, 'bills');
  const col = (name: string) => head.indexOf(name);
  expect(rows).toHaveLength(paid().length); // one line per paid bill, refunded ones included and marked
  expect(rows.map((r) => r[col('Order')])).toEqual(paid().map((b) => b.token));
  const live = rows.filter((r) => !r[col('Refunded')]);
  expect(live.reduce((a, r) => a + +r[col('Total')], 0)).toBe(takings);
  expect(rows.filter((r) => r[col('Refunded')]).map((r) => r[col('Refund reason')])).toEqual(
    Array(3).fill('Food issue'),
  );
  for (const r of rows)
    expect(
      Math.round((+r[col('Taxable value')] + +r[col('CGST')] + +r[col('SGST')] + +r[col('Round off')]) * 100),
      `bill ${r[col('Order')]}`,
    ).toBe(+r[col('Total')] * 100);
  expect(rows.filter((r) => r[col('Code')] === 'DAY10').length).toBe(paid().filter((b) => b.discountCode).length);

  const gst = await csv(request, 'gst');
  expect(gst).toHaveLength(2);
  expect(gst[1][0]).toBe(DAY());
  expect(+gst[1][1]).toBe(k.length);
  expect(+gst[1][2]).toBe(sum(k, (b) => b.subtotal));
  expect(+gst[1][6]).toBe(takings);

  const dishes = (await csv(request, 'dishes')).slice(1);
  const sold = dishes.filter((r) => !['Extras', 'Discount codes', 'Packaging (takeaway)'].includes(r[0]));
  expect(sold.reduce((a, r) => a + +r[1], 0)).toBe(sum(k, (b) => b.itemCount));
  // dishes + extras + packaging − discounts, all before GST, is the taxable value
  expect(dishes.reduce((a, r) => a + +r[2], 0)).toBe(sum(k, (b) => b.subtotal));
});

test('the kitchen, the TV, the owner’s phone and a customer’s phone all show that same day', async ({
  browser,
  request,
}) => {
  const k = kept();
  // kitchen: the two unfinished orders on the rail, one ready on the shelf, forty in today's list
  const kctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await kctx.addInitScript((pin) => localStorage.setItem('benne14.staffPin', pin), '2468');
  const kitchen = await kctx.newPage();
  await kitchen.goto('/kitchen');
  await expect(kitchen.locator('.chit')).toHaveCount(2);
  await expect(kitchen.getByTestId('chit-36')).toBeVisible();
  await expect(kitchen.getByTestId('chit-38')).toBeVisible();
  await expect(kitchen.getByTestId('ready-37')).toBeVisible();
  await kitchen.getByTestId('open-history').click();
  await expect(kitchen.locator('[data-testid^="hist-"]:not([data-testid^="hist-full"])')).toHaveCount(40);
  await kctx.close();

  // TV: 37 is ready; 36 and 38 are being prepared; a walked-away order never shows
  const tv = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await tv.goto('/board');
  await expect(tv.getByTestId('board-ready')).toContainText('37');
  await expect(tv.getByTestId('board-prep-36')).toBeVisible();
  await expect(tv.getByTestId('board-prep-38')).toBeVisible();
  await expect(tv.getByTestId('board-prep-40')).toHaveCount(0);
  await tv.context().close();

  // owner's phone: takings and the count of orders
  const octx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await octx.addInitScript((pin) => localStorage.setItem('benne14.ownerPin', pin), OWNER);
  const owner = await octx.newPage();
  await owner.goto('/admin');
  await expect(owner.getByTestId('today-takings')).toContainText(sum(k, (b) => b.total).toLocaleString('en-IN'));
  await expect(owner.getByTestId('today-orders')).toHaveText(String(k.length));
  await octx.close();

  // a customer's phone: the bill of a collected order, and of a refunded one
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const collected = bills[0];
  await phone.goto(`/r/${collected.id}`);
  await expect(phone.getByTestId('bill-total')).toContainText(String(collected.total));
  const coded = bills.find((b) => b.discountCode && !b.refundedAt && b.status !== 'cancelled')!;
  await phone.goto(`/r/${coded.id}`);
  await expect(phone.getByTestId('bill-discount')).toContainText(String(coded.savings));
  await expect(phone.getByTestId('bill-total')).toContainText(String(coded.total));
  await phone.context().close();

  // the technical page counted every order placed, and none failed
  const tech = await (await request.get('/api/admin/tech', { headers: H })).json();
  const placed = tech.speed.find((s: { op: string }) => s.op === 'order.place');
  expect(placed.count).toBeGreaterThanOrEqual(40);
  expect(placed.failed).toBe(0);
  expect(tech.ordersToday).toBe(40);
  expect(tech.kitchen.waiting).toBe(2);
});
