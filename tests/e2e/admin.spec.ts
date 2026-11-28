import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { counterPaid } from '../support/kiosk';

// Owner dashboard. Own server (port 3103): these tests change prices and sold-out state, which
// would upset the other suites' expected totals.
const PIN = '246810'; // the owner PIN (it also does everything the staff PIN does)
const STAFF_PIN = '2468';
const H = { 'x-staff-pin': PIN };

test.beforeAll(async ({ request }) => {
  const h = await (await request.get('/api/health')).json();
  if (h.store !== 'memory') throw new Error(`Refusing to run e2e against the ${h.store} store`);
});
test.describe.configure({ mode: 'serial' });

const owner = async (page: Page) => {
  await page.addInitScript((pin) => localStorage.setItem('benne14.ownerPin', pin), PIN);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin');
};
let k = 0;
const order = (r: APIRequestContext, itemId: string, payMethod = 'cash') =>
  r.post('/api/orders', {
    data: {
      key: `adm-${Date.now()}-${k++}`,
      type: 'takeaway',
      name: null,
      payMethod,
      lines: [{ itemId, qty: 1, choices: {}, notes: [] }],
    },
  });
const today = async (r: APIRequestContext) => {
  const d = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  return (await (await r.get(`/api/admin/report?from=${d}&to=${d}`, { headers: H })).json()).current;
};

test('the dashboard and its API need the staff PIN', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin');
  await expect(page.getByTestId('pin-gate')).toBeVisible();
  for (const path of [
    '/api/admin/report?from=2026-11-01&to=2026-11-02',
    '/api/admin/events',
    '/api/admin/export?kind=bills&from=2026-11-01&to=2026-11-02',
  ]) {
    expect((await request.get(path)).status(), path).toBe(401);
  }
  expect((await request.post('/api/admin/menu', { data: { itemId: 'masala-dosa', price: 1 } })).status()).toBe(401);
});

test('admin API refuses bad input with a clear 400/404/409', async ({ request }) => {
  const menu = (data: object) => request.post('/api/admin/menu', { data, headers: H });
  for (const bad of [
    { itemId: 'pizza', price: 100 },
    { itemId: 'masala-dosa', price: 0 },
    { itemId: 'masala-dosa', price: -5 },
    { itemId: 'masala-dosa', price: 1.5 },
    { itemId: 'masala-dosa', price: '200' },
    { itemId: 'masala-dosa', price: 100001 },
    { itemId: 'masala-dosa', name: 'x'.repeat(41) },
    { itemId: 'masala-dosa', desc: 'x'.repeat(161) },
    { itemId: 'masala-dosa', soldOut: 'yes' },
    { itemId: 'masala-dosa', name: 5 },
  ]) {
    expect((await menu(bad)).status(), JSON.stringify(bad)).toBe(400);
  }
  const opt = (o: object) => menu({ itemId: 'masala-dosa', options: [o] });
  expect((await opt({ groupId: 'dosaExtras', optionId: 'gold', price: 10 })).status()).toBe(400);
  expect((await opt({ groupId: 'sugar', optionId: 'less', price: 10 })).status()).toBe(400); // pick-one choices have no price
  expect((await opt({ groupId: 'constructor', optionId: 'x', price: 10 })).status()).toBe(400);
  expect((await opt({ groupId: 'dosaExtras', optionId: 'benne', price: -1 })).status()).toBe(400);
  expect((await menu({ itemId: 'masala-dosa', options: 'benne' })).status()).toBe(400);
  // one bad extra refuses the whole edit: the dish price in the same request is not saved either
  expect(
    (
      await menu({
        itemId: 'masala-dosa',
        price: 555,
        options: [{ groupId: 'dosaExtras', optionId: 'benne', price: -1 }],
      })
    ).status(),
  ).toBe(400);
  expect((await (await request.get('/api/menu')).json()).items['masala-dosa']?.price ?? null).not.toBe(555);
  const rep = (q: string) => request.get(`/api/admin/report?${q}`, { headers: H });
  for (const q of [
    '',
    'from=2026-11-05&to=2026-11-01',
    'from=2024-01-01&to=2026-01-01',
    'from=2026-13-01&to=2026-13-02',
    'from=today&to=now',
    'from=2026-02-30&to=2026-03-01',
  ]) {
    expect((await rep(q)).status(), q).toBe(400);
  }
  expect(
    (await request.get('/api/admin/export?kind=everything&from=2026-11-01&to=2026-11-02', { headers: H })).status(),
  ).toBe(400);
  const unpaid = await (await order(request, 'masala-tea')).json();
  const refund = (id: string, data: object) => request.post(`/api/admin/orders/${id}/refund`, { data, headers: H });
  expect((await refund(unpaid.id, { reason: 'Wrong order' })).status()).toBe(409); // not paid: cancel instead
  expect((await refund(unpaid.id, { reason: '  ' })).status()).toBe(400);
  expect((await refund('not-an-id', { reason: 'x' })).status()).toBe(404);
  expect((await refund('00000000-0000-0000-0000-000000000000', { reason: 'x' })).status()).toBe(404);
});

test('sold out in the dashboard greys the dish on the kiosk, and the server refuses it', async ({
  page,
  request,
  browser,
}) => {
  await owner(page);
  await page.getByTestId('tab-menu').click();
  await page.getByTestId('sw-plain-dosa').click();
  await expect(page.getByTestId('mi-plain-dosa')).toContainText('Sold out');

  const kiosk = await browser.newPage({ viewport: { width: 800, height: 1280 } });
  await kiosk.goto('/kiosk');
  await kiosk.getByTestId('start').click();
  await expect(kiosk.getByTestId('item-plain-dosa')).toContainText('Sold out');
  await expect(kiosk.getByTestId('item-plain-dosa')).toHaveAttribute('aria-disabled', 'true');
  await kiosk.getByTestId('item-plain-dosa').click({ force: true }); // a customer taps it anyway
  await expect(kiosk.getByTestId('sheet')).toHaveCount(0); // nothing opens
  expect((await order(request, 'plain-dosa')).status()).toBe(409);

  await page.getByTestId('sw-plain-dosa').click(); // back on
  await expect(page.getByTestId('mi-plain-dosa')).not.toContainText('Sold out');
  expect((await order(request, 'plain-dosa')).status()).toBe(201);
});

test('a dish that sells out mid-order is flagged in the cart, not silently charged', async ({ page, request }) => {
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.goto('/kiosk');
  await page.getByTestId('start').click();
  await page.getByTestId('item-thatte-idli').click();
  await page.getByTestId('add-to-order').click();
  await page.getByTestId('cartbar').click();
  await page.getByTestId('takeaway').click();
  await page.getByTestId('continue-to-pay').click();
  await request.post('/api/admin/menu', { data: { itemId: 'thatte-idli', soldOut: true }, headers: H }); // the owner switches it off now
  await page.getByTestId('pay-cash').click();
  await expect(page.getByText('just sold out')).toBeVisible();
  await page.getByRole('button', { name: /Order/ }).first().click(); // back to the cart
  await expect(page.getByTestId('cart-sold-out')).toBeVisible();
  await expect(page.getByTestId('continue-to-pay')).toBeDisabled();
  await request.post('/api/admin/menu', { data: { itemId: 'thatte-idli', soldOut: false }, headers: H });
});

test('a price change reaches the next order, and old bills keep their price', async ({ page, request }) => {
  const before = await (await order(request, 'masala-dosa')).json();
  expect(before.lines[0].unitPrice).toBe(209);
  await owner(page);
  await page.getByTestId('tab-menu').click();
  await page.getByTestId('mi-masala-dosa').locator('.open').click();
  await page.getByTestId('ed-price').fill('219');
  await page.getByTestId('ed-name').fill('Masala Dosa Special');
  await expect(page.getByTestId('edit-sheet')).toContainText('customers pay about ₹230');
  await page.getByTestId('ed-save').click();
  await expect(page.getByTestId('mi-masala-dosa')).toContainText('₹219');
  const after = await (await order(request, 'masala-dosa')).json();
  expect(after.lines[0]).toMatchObject({ unitPrice: 219, name: 'Masala Dosa Special' });
  expect((await (await request.get(`/api/orders/${before.id}`)).json()).lines[0].unitPrice).toBe(209);
  // and the change is in the history
  await page.getByTestId('open-history').click();
  await expect(page.getByTestId('history')).toContainText('₹209 → ₹219');
  await expect(page.getByTestId('history')).toContainText('Renamed Masala Dosa to Masala Dosa Special');
  // an extra's price saved in the same step is this dish's own: the other dosas keep theirs
  await page.getByRole('button', { name: 'Back to menu' }).click();
  await page.getByTestId('mi-plain-dosa').locator('.open').click();
  await page.getByLabel('Extra benne price').fill('30');
  await page.getByTestId('ed-price').fill('175');
  await page.getByTestId('ed-save').click();
  await expect(page.getByTestId('mi-plain-dosa')).toContainText('₹175');
  const withExtra = await (
    await request.post('/api/orders', {
      data: {
        key: `adm-extra-${Date.now()}`,
        type: 'takeaway',
        name: null,
        payMethod: 'cash',
        lines: [
          { itemId: 'plain-dosa', qty: 1, choices: { 'd-plain-dosa': ['benne'] }, notes: [] },
          { itemId: 'masala-dosa', qty: 1, choices: { dosaExtras: ['benne'] }, notes: [] },
        ],
      },
    })
  ).json();
  expect(withExtra.lines.map((l: { unitPrice: number }) => l.unitPrice)).toEqual([175 + 30, 219 + 25]);
  // reset for the next tests
  await request.post('/api/admin/menu', {
    data: {
      itemId: 'masala-dosa',
      price: null,
      name: null,
      options: [{ groupId: 'dosaExtras', optionId: 'benne', price: 25 }],
    },
    headers: H,
  });
  await request.post('/api/admin/menu', { data: { itemId: 'plain-dosa', price: null }, headers: H });
});

test('confirming a payment and recording a refund move today’s takings', async ({ page, request }) => {
  const o = await (await order(request, 'medu-vada')).json(); // cash, waits at the counter
  const start = await today(request);
  await owner(page);
  const need = page.getByTestId(`need-${o.token}`);
  await expect(need).toBeVisible({ timeout: 8000 });
  await need.getByRole('button', { name: 'Paid' }).click();
  await expect(need).toHaveCount(0, { timeout: 8000 });
  await expect.poll(async () => (await today(request)).takings).toBe(start.takings + o.total);

  await page.getByTestId('tab-orders').click();
  await page.getByTestId(`ord-${o.token}`).click();
  await page.getByTestId('sheet-refund').click();
  await expect(page.getByTestId('sheet-record-refund')).toBeDisabled(); // a reason is required
  await page.getByRole('button', { name: 'Food issue' }).click();
  await page.getByTestId('sheet-record-refund').click();
  await expect(page.getByTestId('order-sheet')).toContainText('Refunded');
  // the order's own history: every change of state with its time, as recorded when it happened
  const timeline = page.getByTestId('timeline');
  await expect(timeline).toContainText('Ordered at the kiosk');
  await expect(timeline).toContainText('Payment confirmed');
  await expect(timeline).toContainText(`Refunded ₹${o.total} · Food issue`);
  expect((await request.get(`/api/admin/orders/${o.id}/events`)).status()).toBe(401); // history needs the PIN
  const log = await (await request.get(`/api/admin/orders/${o.id}/events`, { headers: H })).json();
  expect(log.map((e: { kind: string }) => e.kind)).toEqual(['placed', 'status', 'refund']);
  // the kitchen's "Today" total follows the same rule as the dashboard: a refunded order is not takings
  expect((await request.post(`/api/orders/${o.id}/status`, { data: { to: 'cancelled' }, headers: H })).status()).toBe(
    409,
  ); // and a paid order can't be cancelled out of the books
  const end = await today(request);
  expect(end.takings).toBe(start.takings);
  expect(end.refunds.amount).toBe(start.refunds.amount + o.total);
  expect(
    (await request.post(`/api/admin/orders/${o.id}/refund`, { data: { reason: 'again' }, headers: H })).status(),
  ).toBe(409);
});

test('reports: today vs yesterday on the dashboard, CSV downloads for the CA', async ({ page, request }) => {
  const paid = await (await order(request, 'mallige-idli')).json();
  await request.post(`/api/orders/${paid.id}/status`, { data: { to: 'new' }, headers: H });
  await owner(page);
  await expect(page.getByTestId('today-takings')).toContainText('₹');
  await expect(page.getByTestId('today-slip')).toContainText(/than yesterday|Same as yesterday/);
  await page.getByTestId('tab-reports').click();
  await expect(page.getByTestId('gst')).toContainText('Taxable value');
  await expect(page.getByTestId('dishes')).toContainText('Mallige Idli');
  await expect(page.getByTestId('dishes')).not.toContainText('Udupi Medu Vada'); // refunded: left out
  for (const k of ['range-day', 'range-month', 'range-custom', 'range-week']) await page.getByTestId(k).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('dl-bills').click()]);
  expect(dl.suggestedFilename()).toMatch(/^benne14-bills-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/);
  const text = await (await dl.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8'));
  expect(text.split('\r\n')[0]).toContain(
    'Date,Time,Invoice,Order,Type,Payment,Items,Discount,Code,Packaging,Taxable value,CGST,SGST,Round off,Total',
  );
  expect(text).toContain('Food issue');
});

test('a request that never comes back does not leave the owner app on "Loading" for good', async ({ page }) => {
  // On a phone a request can be frozen with the app and never answer, time limit and all.
  const silent = { report: 1, system: 1 }; // how many calls to each get no answer at all
  const neverAnswers = (path: string, which: keyof typeof silent) =>
    page.route(path, (r) => (silent[which]-- > 0 ? new Promise<void>(() => {}) : r.continue()));
  await page.clock.install();
  await neverAnswers('**/api/admin/report**', 'report');
  await neverAnswers('**/api/admin/system', 'system');
  await owner(page);
  await expect(page.getByTestId('today-takings')).toHaveText('…');
  await page.clock.runFor(15_000);
  await expect(page.getByTestId('today-takings')).toHaveText('…'); // still within what a slow request may take
  await page.clock.runFor(8_000); // past it: the app gives up on that call and asks again
  await expect(page.getByTestId('today-takings')).toContainText('₹', { timeout: 10_000 });
  await expect(page.getByTestId('sysline')).not.toContainText('Checking', { timeout: 10_000 });
  // and the Reports tab, which asks only once per range, recovers the same way
  silent.report = 1;
  await page.getByTestId('tab-reports').click();
  await page.clock.runFor(22_000);
  await expect(page.getByTestId('gst')).toContainText('Taxable value', { timeout: 10_000 });
});

test('the kiosk keeps working with the last menu if the menu can’t load', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.route('**/api/menu', (r) => r.abort('internetdisconnected'));
  await page.goto('/kiosk');
  await page.getByTestId('start').click();
  await expect(page.getByTestId('item-masala-dosa')).toContainText('₹209');
});

// ---------- Offers: discount codes, phone numbers, the kiosk switches ----------
const offers = (r: APIRequestContext, data: object, headers: Record<string, string> = H) =>
  r.post('/api/admin/offers', { data, headers });
const PHONE = '9876543210';

test('offers API: needs the PIN and refuses bad codes, numbers and switches', async ({ request }) => {
  for (const path of ['/api/admin/offers', '/api/admin/customers', '/api/admin/customers?format=csv'])
    expect((await request.get(path)).status(), path).toBe(401);
  expect((await offers(request, { settings: { phone: false } }, {})).status()).toBe(401);
  const ok = { code: 'TEN', kind: 'percent', value: 10 };
  for (const bad of [
    {},
    { settings: 'off' },
    { settings: { phone: 'no' } },
    { settings: { cash: 'yes' } },
    { code: { ...ok, code: 'AB' } },
    { code: { ...ok, code: 'SAVE ₹50' } },
    { code: { ...ok, kind: 'bogof' } },
    { code: { ...ok, value: 0 } },
    { code: { ...ok, value: 95 } },
    { code: { ...ok, value: 2.5 } },
    { code: { ...ok, minOrder: -1 } },
    { code: { ...ok, expiresOn: '2026-02-30' } },
    { code: { ...ok, active: 'yes' } },
    { code: { ...ok, kind: 'flat', value: 50 } }, // a flat code needs a minimum order above it
    { code: { ...ok, kind: 'flat', value: 50, minOrder: 50 } },
  ])
    expect((await offers(request, bad)).status(), JSON.stringify(bad)).toBe(400);
  // the kiosk's side
  const place = (extra: object) =>
    request.post('/api/orders', {
      data: {
        key: `off-${Date.now()}-${k++}`,
        type: 'takeaway',
        name: null,
        payMethod: 'cash',
        lines: [{ itemId: 'masala-tea', qty: 1, choices: {}, notes: [] }],
        ...extra,
      },
    });
  for (const phone of ['12345', '1234567890', 'call me', 98765]) expect((await place({ phone })).status()).toBe(400);
  expect((await place({ code: '<b>' })).status()).toBe(400);
  expect((await place({ code: 'NOSUCHCODE' })).status()).toBe(409); // never charged in full without saying so
  const check = await request.post('/api/discounts/check', {
    data: { code: 'NOSUCHCODE', lines: [{ itemId: 'masala-tea', qty: 1, choices: {}, notes: [] }] },
    headers: { 'x-forwarded-for': '10.9.9.1' },
  });
  expect(check.status()).toBe(404);
});

test('guessing discount codes is cut off after ten wrong tries', async ({ request }) => {
  const guess = (code: string) =>
    request.post('/api/discounts/check', {
      data: { code, lines: [{ itemId: 'masala-tea', qty: 1, choices: {}, notes: [] }] },
      headers: { 'x-forwarded-for': '10.9.9.2' },
    });
  for (let i = 0; i < 10; i++) expect((await guess(`GUESS${i}`)).status()).toBe(404);
  expect((await guess('GUESS10')).status()).toBe(429);
});

test('owner makes a code; a customer uses it and leaves a number; the bill and the dashboard show both', async ({
  page,
  request,
}) => {
  // owner: new code, 10% off
  await owner(page);
  await page.getByTestId('tab-offers').click();
  await expect(page.getByTestId('set-codes')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('new-code').click();
  await page.getByTestId('dc-code').fill('welcome10');
  await page.getByTestId('dc-value').fill('10');
  await page.getByTestId('dc-save').click();
  await expect(page.getByTestId('code-WELCOME10')).toContainText('10% off');

  // customer: the cart now offers a code box and a phone box
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.goto('/kiosk');
  await page.getByTestId('start').click();
  await page.getByTestId('item-plain-dosa').click();
  await page.getByTestId('add-to-order').click();
  await page.getByTestId('cartbar').click();
  const total = async () => Number((await page.getByTestId('cart-total').innerText()).replace(/\D/g, ''));
  const full = await total();
  await page.getByTestId('code-input').fill('wrongcode');
  await page.getByTestId('code-apply').click();
  await expect(page.getByTestId('code-error')).toContainText('isn’t valid');
  await expect(page.getByTestId('discount-row')).toHaveCount(0);
  await page.getByTestId('code-input').fill('welcome10');
  await page.getByTestId('code-apply').click();
  await expect(page.getByTestId('discount-row')).toContainText('Code WELCOME10');
  const less = await total();
  expect(less).toBeLessThan(full);
  expect(less).toBeGreaterThan(full * 0.88); // 10% off before GST
  await page.getByTestId('code-remove').click();
  expect(await total()).toBe(full);
  await page.getByTestId('code-input').fill('WELCOME10');
  await page.getByTestId('code-apply').click();
  await expect(page.getByTestId('discount-row')).toBeVisible();

  // a half-typed number blocks paying; a whole one (or none) doesn't
  await page.getByTestId('dine-in').click();
  await page.getByTestId('phone-input').fill('98765');
  await expect(page.getByTestId('phone-error')).toBeVisible();
  await expect(page.getByTestId('continue-to-pay')).toBeDisabled();
  await page.getByTestId('phone-input').fill(PHONE);
  await page.getByTestId('continue-to-pay').click();
  await page.getByTestId('pay-cash').click();
  await expect(page.getByTestId('at-counter')).toBeVisible(); // placed, and waiting for the counter

  // the order: discounted, code recorded, and the number nowhere a screen can read it
  const list = await (await request.get('/api/orders?view=today')).json();
  const o = list[0];
  expect(o).toMatchObject({ discountCode: 'WELCOME10', total: less });
  expect(o.savings).toBeGreaterThan(0);
  expect(JSON.stringify(list)).not.toContain(PHONE);
  expect(JSON.stringify(await (await request.get(`/api/orders/${o.id}`)).json())).not.toContain(PHONE);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/r/${o.id}`);
  await expect(page.getByTestId('bill-discount')).toContainText('Discount (WELCOME10)');

  // dashboard: a customer only once the order is paid
  expect(await (await request.get('/api/admin/customers', { headers: H })).json()).toEqual([]);
  await request.post(`/api/orders/${o.id}/status`, { data: { to: 'new' }, headers: H });
  await page.goto('/admin');
  await page.getByTestId('tab-offers').click();
  await expect(page.getByTestId('customer')).toContainText('98765 43210');
  const csv = await (await request.get('/api/admin/customers?format=csv', { headers: H })).text();
  expect(csv).toContain(`91${PHONE}`);
  expect((await today(request)).discounts).toEqual({ count: 1, amount: o.savings });
  const bills = await (
    await request.get(`/api/admin/export?kind=bills&from=${o.tokenDay}&to=${o.tokenDay}`, { headers: H })
  ).text();
  expect(bills).toContain('WELCOME10');
  expect(bills).not.toContain(PHONE);
});

test('a code with a minimum order says what is missing instead of failing silently', async ({ page, request }) => {
  expect((await offers(request, { code: { code: 'BIG100', kind: 'flat', value: 100, minOrder: 5000 } })).status()).toBe(
    200,
  );
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.goto('/kiosk');
  await page.getByTestId('start').click();
  await page.getByTestId('item-masala-tea').click();
  await page.getByTestId('add-to-order').click();
  await page.getByTestId('cartbar').click();
  await page.getByTestId('code-input').fill('BIG100');
  await page.getByTestId('code-apply').click();
  await expect(page.getByTestId('code-short')).toContainText('more to use it');
  await expect(page.getByTestId('discount-row')).toHaveCount(0);
  // and the server refuses to place it as if the code had worked
  const r = await request.post('/api/orders', {
    data: {
      key: `min-${Date.now()}`,
      type: 'takeaway',
      name: null,
      payMethod: 'cash',
      code: 'BIG100',
      lines: [{ itemId: 'masala-tea', qty: 1, choices: {}, notes: [] }],
    },
  });
  expect(r.status()).toBe(409);
  expect((await r.json()).error).toContain('needs an order of ₹5000');
});

test('the owner switches card off: the kiosk offers no card tile, and the server refuses a card order', async ({
  page,
  request,
}) => {
  let k = 0;
  const cardOrder = () =>
    request.post('/api/orders', {
      data: {
        key: `card-${Date.now()}-${k++}`,
        type: 'takeaway',
        name: 'Card',
        payMethod: 'card',
        lines: [{ itemId: 'masala-tea', qty: 1, choices: {}, notes: [] }],
      },
    });
  const payScreen = async () => {
    await page.setViewportSize({ width: 800, height: 1280 });
    await page.goto('/kiosk');
    await page.getByTestId('start').click();
    await page.getByTestId('item-masala-tea').click();
    await page.getByTestId('add-to-order').click();
    await page.getByTestId('cartbar').click();
    await page.getByTestId('takeaway').click();
    await page.getByTestId('continue-to-pay').click();
    await expect(page.getByTestId('pay-upi')).toBeVisible();
  };
  try {
    expect((await offers(request, { settings: { card: 'yes' } })).status()).toBe(400);
    await owner(page);
    await page.getByTestId('tab-offers').click();
    await expect(page.getByTestId('set-card')).toHaveAttribute('aria-checked', 'true'); // the tests' server starts with card on
    await page.getByTestId('set-card').click();
    await expect(page.getByTestId('set-card')).toHaveAttribute('aria-checked', 'false');
    await expect.poll(async () => (await (await request.get('/api/kiosk')).json()).card).toBe(false);

    await payScreen();
    await expect(page.getByTestId('pay-card')).toHaveCount(0);
    await expect(page.getByTestId('pay-cash')).toBeVisible(); // cash has its own switch
    const refused = await cardOrder();
    expect(refused.status()).toBe(409);
    expect((await refused.json()).error).toContain('Cards are not taken');

    await offers(request, { settings: { card: true } });
    await payScreen();
    await expect(page.getByTestId('pay-card')).toBeVisible();
    expect((await cardOrder()).status()).toBe(201);
  } finally {
    await offers(request, { settings: { card: true } }); // other tests pay by card
  }
});

test('the owner switches cash off: the kiosk offers UPI and card only, and the server refuses a cash order', async ({
  page,
  request,
}) => {
  const cashOrder = () =>
    request.post('/api/orders', {
      data: {
        key: `cash-${Date.now()}-${k++}`,
        type: 'takeaway',
        name: 'Cash',
        payMethod: 'cash',
        lines: [{ itemId: 'masala-tea', qty: 1, choices: {}, notes: [] }],
      },
    });
  const payScreen = async () => {
    await page.setViewportSize({ width: 800, height: 1280 });
    await page.goto('/kiosk');
    await page.getByTestId('start').click();
    await page.getByTestId('item-masala-tea').click();
    await page.getByTestId('add-to-order').click();
    await page.getByTestId('cartbar').click();
    await page.getByTestId('takeaway').click();
    await page.getByTestId('continue-to-pay').click();
    await expect(page.getByTestId('pay-upi')).toBeVisible();
  };
  try {
    await owner(page);
    await page.getByTestId('tab-offers').click();
    await expect(page.getByTestId('set-cash')).toHaveAttribute('aria-checked', 'true'); // the tests' server starts with cash on
    await page.getByTestId('set-cash').click();
    await expect(page.getByTestId('set-cash')).toHaveAttribute('aria-checked', 'false');
    await expect.poll(async () => (await (await request.get('/api/kiosk')).json()).cash).toBe(false);

    await payScreen();
    await expect(page.getByTestId('pay-upi')).toBeVisible();
    await expect(page.getByTestId('pay-cash')).toHaveCount(0);
    const refused = await cashOrder();
    expect(refused.status()).toBe(409);
    expect((await refused.json()).error).toContain('Cash is not taken');

    await offers(request, { settings: { cash: true } });
    await payScreen();
    await expect(page.getByTestId('pay-cash')).toBeVisible();
    expect((await cashOrder()).status()).toBe(201);
  } finally {
    await offers(request, { settings: { cash: true } }); // the other tests here pay by cash
  }
});

test('the owner can switch the code box and the phone box off; the server then ignores both', async ({
  page,
  request,
}) => {
  await owner(page);
  await page.getByTestId('tab-offers').click();
  await page.getByTestId('set-codes').click();
  await page.getByTestId('set-phone').click();
  await expect(page.getByTestId('set-phone')).toHaveAttribute('aria-checked', 'false');
  await expect.poll(async () => (await request.get('/api/kiosk')).json()).toMatchObject({ codes: false, phone: false });

  await page.setViewportSize({ width: 800, height: 1280 });
  await page.goto('/kiosk');
  await page.getByTestId('start').click();
  await page.getByTestId('item-masala-tea').click();
  await page.getByTestId('add-to-order').click();
  await page.getByTestId('cartbar').click();
  await expect(page.getByTestId('cart-total')).toBeVisible();
  await expect(page.getByTestId('code-input')).toHaveCount(0);
  await expect(page.getByTestId('phone-input')).toHaveCount(0);

  const place = (extra: object) =>
    request.post('/api/orders', {
      data: {
        key: `sw-${Date.now()}-${k++}`,
        type: 'takeaway',
        name: 'Switched',
        payMethod: 'cash',
        lines: [{ itemId: 'masala-tea', qty: 1, choices: {}, notes: [] }],
        ...extra,
      },
    });
  expect((await place({ code: 'WELCOME10' })).status()).toBe(409);
  const o = await (await place({ phone: '9123456780' })).json();
  await request.post(`/api/orders/${o.id}/status`, { data: { to: 'new' }, headers: H });
  const customers = await (await request.get('/api/admin/customers', { headers: H })).json();
  expect(JSON.stringify(customers)).not.toContain('9123456780'); // switched off: the number was not kept

  // back on, but with every code switched off the box stays hidden (it would lead nowhere)
  await offers(request, { settings: { codes: true, phone: true } });
  expect((await (await request.get('/api/kiosk')).json()).codes).toBe(true);
  for (const c of (await (await request.get('/api/admin/offers', { headers: H })).json()).codes)
    await offers(request, { code: { ...c, active: false } });
  expect(await (await request.get('/api/kiosk')).json()).toMatchObject({ codes: false, phone: true });
  // a code can be deleted from its sheet (asked twice); orders that used it keep its name
  expect((await offers(request, { remove: 'NOSUCHCODE' })).status()).toBe(404);
  expect((await offers(request, { remove: 'BIG100' }, {})).status()).toBe(401);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin');
  await page.getByTestId('tab-offers').click();
  await page.getByTestId('code-BIG100').locator('.open').click();
  await page.getByTestId('dc-delete').click();
  await expect(page.getByTestId('dc-delete')).toHaveText('Yes, delete BIG100');
  await page.getByTestId('dc-delete').click();
  await expect(page.getByTestId('code-BIG100')).toHaveCount(0);
  await expect(page.getByTestId('code-WELCOME10')).toBeVisible();
  expect(
    (await (await request.get('/api/admin/offers', { headers: H })).json()).codes.map((c: { code: string }) => c.code),
  ).toEqual(['WELCOME10']);
  const usedIt = (await (await request.get('/api/orders?view=today')).json()).find(
    (x: { discountCode?: string }) => x.discountCode === 'WELCOME10',
  );
  expect(usedIt.savings).toBeGreaterThan(0);
  const history = await (await request.get('/api/admin/events', { headers: H })).json();
  expect(history.some((e: { kind: string }) => e.kind === 'setting')).toBe(true);
  expect(history.some((e: { kind: string }) => e.kind === 'discount')).toBe(true);
});

test('a price change reaches the TV banner and an open kiosk cart within half a minute', async ({ page, request }) => {
  const setPrice = (itemId: string, price: number | null) =>
    request.post('/api/admin/menu', { data: { itemId, price }, headers: H });
  await page.clock.install();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/board');
  await expect(page.locator('.promo')).toBeVisible();
  expect((await setPrice('medu-vada', 97)).status()).toBe(200);
  // the banner rotates through three dishes: wait for the vada to come round with its new price
  let seen = '';
  for (let i = 0; i < 10 && !seen.includes('₹97'); i++) {
    await page.clock.runFor(8_000);
    seen = await page.locator('.promo').innerText();
  }
  expect(seen).toContain('₹97');

  // a customer already in the cart sees the new price on the suggestion too
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.goto('/kiosk');
  await page.getByTestId('start').click();
  await page.getByTestId('item-plain-dosa').click();
  await page.getByTestId('add-to-order').click();
  await page.getByTestId('cartbar').click();
  const first = page.locator('[data-testid^="suggest-"]').first();
  const id = (await first.getAttribute('data-testid'))!.replace('suggest-', '');
  expect((await setPrice(id, 103)).status()).toBe(200);
  await expect(first).not.toContainText('₹103'); // not yet: the kiosk asks again every half minute
  await page.clock.runFor(31_000);
  await expect(page.getByTestId(`suggest-${id}`)).toContainText('₹103');
  await setPrice(id, null);
  await setPrice('medu-vada', null); // back to the menu's own price
});

test('orders list: a long order is shown in full, not cut off', async ({ page, request }) => {
  const lines = [
    'masala-dosa',
    'plain-benne-dosa',
    'ghee-podi-thatte-idli',
    'medu-vada',
    'filter-coffee',
    'masala-tea',
  ];
  const o = await (
    await request.post('/api/orders', {
      data: {
        key: `long-admin-${Date.now()}`,
        type: 'dine_in',
        name: 'Big Table',
        payMethod: 'cash',
        lines: lines.map((itemId) => ({ itemId, qty: 2, choices: {}, notes: [] })),
      },
    })
  ).json();
  await owner(page);
  await page.getByTestId('tab-orders').click();
  const l2 = page.getByTestId(`ord-${o.token}`).locator('.l2');
  await expect(l2).toContainText('2 × Masala Tea'); // the last dish
  expect(await l2.evaluate((el) => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight)).toBe(true);
});

// ---- The owner's own dishes: add (with a photo), check, publish, reorder, hide, bring back ----
const dishes = (r: APIRequestContext, data: object, headers: Record<string, string> = H) =>
  r.post('/api/admin/dishes', { data, headers });
const publicMenu = async (r: APIRequestContext) => (await r.get('/api/menu')).json();
const orderIt = (r: APIRequestContext, itemId: string) => order(r, itemId);

test('owner adds a dish with a photo, checks it, publishes it; customers can then order it', async ({
  page,
  request,
  browser,
}) => {
  await owner(page);
  await page.getByTestId('tab-menu').click();
  await page.getByTestId('open-add').click();
  await page.getByTestId('add-dish').click();
  await page.getByTestId('dish-save').click();
  await expect(page.getByTestId('dish-err')).toContainText('needs a name'); // nothing half-made is saved
  await page.getByTestId('dish-name').fill('Onion Benne Dosa');
  await page.getByTestId('dish-price').fill('179');
  await page.getByTestId('dish-desc').fill('Crisp benne dosa with caramelised onion inside.');
  await page.getByTestId('dish-file').setInputFiles('public/food/plain-benne-dosa.jpg');
  await expect(page.getByTestId('dish-photo')).toBeVisible({ timeout: 10_000 });
  // a new dosa starts with the usual "Comes with" line and no extras; the owner gives it one
  await expect(page.getByTestId('dish-with')).toHaveValue('Comes with coconut chutney and sambar');
  await expect(page.getByTestId('extra-row')).toHaveCount(0);
  await page.getByTestId('extra-add').click();
  await page.getByTestId('dish-save').click();
  await expect(page.getByTestId('dish-err')).toContainText('needs a name'); // an empty row is not saved
  await page.getByTestId('extra-name').fill('Extra benne');
  await page.getByTestId('extra-price').fill('25');
  await page.getByTestId('dish-save').click();

  // the check page: how customers will see it, and it is not on the kiosk yet
  const check = page.getByTestId('dish-check');
  await expect(check).toContainText('How customers will see it');
  await expect(check).toContainText('₹179');
  await expect(check).toContainText('about ₹188');
  await expect(check).toContainText('Extra benne');
  const draft = (await (await request.get('/api/admin/dishes', { headers: H })).json()).custom[0];
  expect(draft).toMatchObject({
    name: 'Onion Benne Dosa',
    price: 179,
    live: false,
    cat: 'dosa',
    groups: [],
  });
  const benne = (await extrasNow(request)).dish![draft.id][0];
  expect(benne).toMatchObject({ name: 'Extra benne', price: 25 });
  expect((await publicMenu(request)).custom).toEqual([]); // a draft is the owner's own business
  expect((await orderIt(request, draft.id)).status()).toBe(400); // and can't be ordered

  await page.getByTestId('dish-publish').click();
  await expect(page.getByTestId(`mi-${draft.id}`)).toBeVisible();
  await expect(page.getByTestId(`sw-${draft.id}`)).toBeVisible(); // a live dish has the sold-out switch
  expect((await publicMenu(request)).custom[0]).toMatchObject({ id: draft.id, live: true });

  // the kiosk shows it, photo and all, and the server prices it
  const kiosk = await (await browser.newContext({ viewport: { width: 800, height: 1280 } })).newPage();
  await kiosk.goto('/kiosk');
  await kiosk.getByTestId('start').click();
  await expect(kiosk.getByText('Onion Benne Dosa').first()).toBeVisible();
  const o = await (
    await request.post('/api/orders', {
      data: {
        key: `own-dish-${Date.now()}`,
        type: 'takeaway',
        name: null,
        payMethod: 'cash',
        lines: [{ itemId: draft.id, qty: 2, choices: { [`d-${draft.id}`]: [benne.id] }, notes: [] }],
      },
    })
  ).json();
  expect(o.lines[0]).toMatchObject({ name: 'Onion Benne Dosa', qty: 2 });
  expect(o.subtotal).toBe(2 * (179 + 25) + 2 * 15); // a takeaway: an owner-made dish is packed like any other
  await kiosk.context().close();

  // history has the moment it went on the menu
  await page.getByTestId('open-history').click();
  await expect(page.getByTestId('history')).toContainText('Onion Benne Dosa');
  await expect(page.getByTestId('history')).toContainText('Added to the menu');
});

test('owner drags a dish to a new place; the kiosk menu follows', async ({ page, request }) => {
  const id = (await publicMenu(request)).custom[0].id as string;
  await owner(page);
  await page.getByTestId('tab-menu').click();
  const names = () =>
    page
      .getByTestId('mcat-dosa')
      .locator('.mi')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-dish')));
  await expect.poll(async () => (await names()).at(-1)).toBe('Onion Benne Dosa'); // a new dish starts last in its section
  const before = await names();
  const grip = page.getByTestId(`grip-${id}`);
  await grip.scrollIntoViewIfNeeded();
  const box = (await grip.boundingBox())!;
  const row = (await page.getByTestId(`mi-${id}`).boundingBox())!;
  await page.mouse.move(box.x + 8, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 8, box.y + box.height / 2 - row.height * 2, { steps: 12 }); // up two places
  await page.mouse.up();
  const want = [...before];
  want.splice(want.length - 3, 0, want.pop()!);
  await expect.poll(names).toEqual(want);
  // saved: the public menu carries the order, and a reload shows the same
  await expect.poll(async () => ((await publicMenu(request)).order as string[]).includes(id)).toBe(true);
  await page.reload();
  await page.getByTestId('tab-menu').click();
  await expect.poll(names).toEqual(want);
});

test('owner hides a dish and brings it back; a hidden dish cannot be ordered', async ({ page, request }) => {
  const id = (await publicMenu(request)).custom[0].id as string;
  await owner(page);
  await page.getByTestId('tab-menu').click();
  // one the owner added
  await page.getByTestId(`mi-${id}`).locator('.open').click();
  await page.getByTestId('dish-hide').click();
  await expect(page.getByTestId('dish-hide')).toContainText('Yes, hide Onion Benne Dosa'); // asks once more
  await page.getByTestId('dish-hide').click();
  await expect(page.getByTestId('mcat-hidden')).toContainText('Onion Benne Dosa');
  expect((await orderIt(request, id)).status()).toBe(400);
  // and one that came with the app
  await page.getByTestId('mi-thatte-idli').locator('.open').click();
  await page.getByTestId('dish-hide').click();
  await page.getByTestId('dish-hide').click();
  await expect(page.getByTestId('mcat-hidden')).toContainText('Thatte Idli');
  expect((await publicMenu(request)).hidden.sort()).toEqual([id, 'thatte-idli'].sort());
  expect((await orderIt(request, 'thatte-idli')).status()).toBe(400);

  await page.getByTestId('show-thatte-idli').click();
  await page.getByTestId(`show-${id}`).click();
  await expect(page.getByTestId('mcat-hidden')).toHaveCount(0);
  expect((await publicMenu(request)).hidden).toEqual([]);
  expect((await orderIt(request, 'thatte-idli')).ok()).toBe(true);
});

test('owner changes the photo of a dish that came with the app; the kiosk shows it; the original can come back', async ({
  page,
  request,
  browser,
}) => {
  const srcOnKiosk = async () => {
    const kiosk = await browser.newPage({ viewport: { width: 800, height: 1280 } });
    await kiosk.goto('/kiosk');
    await kiosk.getByTestId('start').click();
    const src = await kiosk.getByTestId('item-mallige-idli').locator('img').first().getAttribute('src');
    await kiosk.close();
    return src;
  };
  expect(await srcOnKiosk()).toBe('/food/mallige-idli.jpg');
  const priceBefore = (await (await order(request, 'mallige-idli')).json()).total;

  await owner(page);
  await page.getByTestId('tab-menu').click();
  await page.getByTestId('mi-mallige-idli').locator('.open').click();
  const sheet = page.getByTestId('edit-sheet');
  await expect(sheet.getByTestId('dish-photo')).toHaveAttribute('src', '/food/mallige-idli.jpg'); // what it has now
  await expect(sheet.getByTestId('ed-photo-reset')).toHaveCount(0); // nothing to go back to yet
  await sheet.getByTestId('dish-file').setInputFiles('public/food/thatte-idli.jpg');
  await expect(sheet.getByTestId('dish-photo')).toHaveAttribute('src', /^data:image\/jpeg/, { timeout: 10_000 });
  await sheet.getByTestId('ed-save').click();
  await expect(sheet).toHaveCount(0);
  // the owner's list, the public menu and the kiosk all show the new photo; nothing else changed
  await expect(page.getByTestId('mi-mallige-idli').locator('img')).toHaveAttribute('src', /^data:image\/jpeg/);
  const menu = await publicMenu(request);
  expect(menu.extras.photos['mallige-idli']).toMatch(/^data:image\/jpeg/);
  expect(await srcOnKiosk()).toMatch(/^data:image\/jpeg/);
  expect((await (await order(request, 'mallige-idli')).json()).total).toBe(priceBefore);
  const log = await (await request.get('/api/admin/events', { headers: H })).json();
  expect(log[0]).toMatchObject({ kind: 'menu', subject: 'Mallige Idli', after: 'New photo' });

  // back to the original
  await page.getByTestId('mi-mallige-idli').locator('.open').click();
  await sheet.getByTestId('ed-photo-reset').click();
  await expect(sheet.getByTestId('dish-photo')).toHaveAttribute('src', '/food/mallige-idli.jpg');
  await sheet.getByTestId('ed-save').click();
  await expect(sheet).toHaveCount(0);
  expect((await publicMenu(request)).extras.photos?.['mallige-idli']).toBeUndefined();
  expect(await srcOnKiosk()).toBe('/food/mallige-idli.jpg');
});

test('photo of a built-in dish: needs the owner PIN, a real dish and a photo this app stored', async ({ request }) => {
  const send = (photo: unknown, headers: Record<string, string> = H) => dishes(request, { photo }, headers);
  // (wrong PINs count towards the lockout of an address: these come from one of their own)
  const elsewhere = { 'x-forwarded-for': '10.44.0.9' };
  expect((await send({ itemId: 'masala-dosa', url: null }, elsewhere)).status()).toBe(401);
  expect((await send({ itemId: 'masala-dosa', url: null }, { ...elsewhere, 'x-staff-pin': STAFF_PIN })).status()).toBe(
    401,
  );
  for (const bad of [
    null,
    'masala-dosa',
    { itemId: 'no-such-dish', url: null },
    { itemId: 'test-1', url: null }, // the payment test dish is not the owner's to change
    { itemId: 'masala-dosa', url: 'https://example.com/someone-elses.jpg' },
    { itemId: 'masala-dosa', url: '/food/plain-dosa.jpg' },
    { itemId: 'masala-dosa', url: 'javascript:alert(1)' },
    { itemId: 'masala-dosa', url: 42 },
  ])
    expect((await send(bad)).status(), JSON.stringify(bad)).toBe(400);
  expect((await send({ itemId: 'masala-dosa', url: null })).status()).toBe(200); // nothing to undo is fine
  expect((await publicMenu(request)).extras?.photos?.['masala-dosa']).toBeUndefined();
});

test('dishes API: PIN, bad input, drafts, photos', async ({ request }) => {
  const good = { cat: 'idli', name: 'Rava Idli', desc: 'Soft.', price: 99, groups: ['idliExtras'], photo: null };
  expect((await request.get('/api/admin/dishes')).status()).toBe(401);
  expect((await dishes(request, { dish: good }, {})).status()).toBe(401);
  expect((await request.post('/api/admin/photo', { data: Buffer.from([0xff, 0xd8, 0xff]) })).status()).toBe(401);
  for (const bad of [
    {},
    { dish: null },
    { dish: { ...good, name: '' } },
    { dish: { ...good, name: 'x'.repeat(41) } },
    { dish: { ...good, price: 0 } },
    { dish: { ...good, price: 99.5 } },
    { dish: { ...good, price: '99' } },
    { dish: { ...good, cat: 'test' } },
    { dish: { ...good, cat: 'sweets' } },
    { dish: { ...good, groups: ['nope'] } },
    { dish: { ...good, groups: 'idliExtras' } },
    { dish: { ...good, groups: ['idliExtras', 'idliExtras'] } },
    { dish: { ...good, photo: 'https://evil.example/x.jpg' } },
    { dish: { ...good, photo: 'javascript:alert(1)' } },
    { dish: { ...good, name: 'masala dosa' } }, // already on the menu
    { order: ['masala-dosa', 'masala-dosa'] },
    { order: ['no-such-dish'] },
    { order: 'masala-dosa' },
  ])
    expect((await dishes(request, bad)).status(), JSON.stringify(bad).slice(0, 80)).toBe(400);
  expect((await dishes(request, { dish: { ...good, id: 'c-nosuch0001' } })).status()).toBe(404);
  for (const b of [{ publish: 'masala-dosa' }, { discard: 'x' }, { hide: 'nope' }, { show: 'test-1' }])
    expect((await dishes(request, b)).status(), JSON.stringify(b)).toBe(404);

  // a photo must be a real JPEG, and small
  const photo = (body: Buffer) => request.post('/api/admin/photo', { data: body, headers: H });
  expect((await photo(Buffer.from('<svg onload=alert(1)>'.repeat(10)))).status()).toBe(400);
  expect((await photo(Buffer.alloc(1024 * 1024 + 10, 0xff))).status()).toBe(413);

  // a draft: only the owner sees it; it can be thrown away; a live dish can't
  const d = (await (await dishes(request, { dish: good })).json()).dish;
  expect(d).toMatchObject({ name: 'Rava Idli', live: false });
  expect(((await publicMenu(request)).custom as { id: string }[]).some((c) => c.id === d.id)).toBe(false);
  expect((await dishes(request, { hide: d.id })).status()).toBe(409); // not on the menu yet
  // the old menu route can switch an added dish off for today, but not rename or reprice it
  expect((await request.post('/api/admin/menu', { data: { itemId: d.id, price: 5 }, headers: H })).status()).toBe(400);
  expect((await dishes(request, { discard: d.id })).ok()).toBe(true);
  expect((await dishes(request, { discard: d.id })).status()).toBe(404);
  const live = (await publicMenu(request)).custom[0];
  expect((await dishes(request, { discard: live.id })).status()).toBe(409);
  expect((await request.post('/api/admin/menu', { data: { itemId: live.id, soldOut: true }, headers: H })).ok()).toBe(
    true,
  );
  expect((await request.post('/api/admin/menu', { data: { itemId: live.id, soldOut: false }, headers: H })).ok()).toBe(
    true,
  );

  // leave the menu as the other tests expect it
  await dishes(request, { hide: live.id });
  await dishes(request, { order: [] });
});

// ---- The owner's sections: add, rename, reorder, hide; a dish in an owner-made section ----
test('owner adds a section, puts a dish in it, renames, reorders and hides sections; the kiosk follows', async ({
  page,
  request,
  browser,
}) => {
  await owner(page);
  await page.getByTestId('tab-menu').click();
  await page.getByTestId('open-add').click();
  await page.getByTestId('open-sections').click();
  const sheet = page.getByTestId('sections-sheet');
  await page.getByTestId('sec-add').click();
  await expect(page.getByTestId('sec-err')).toContainText('name'); // an empty name is not a section
  await page.getByTestId('sec-new').fill('Sweets');
  await page.getByTestId('sec-add').click();
  await expect(sheet.locator('.sec')).toHaveCount(4);
  const sections = async () =>
    (await publicMenu(request)).sections as {
      custom?: { id: string; name: string }[];
      hidden?: string[];
      order?: string[];
      names?: Record<string, string>;
    };
  const sid = (await sections()).custom![0].id;
  expect(sid).toMatch(/^s-[a-z0-9]{8}$/);

  // rename one that came with the app
  await page.getByTestId('sec-drinks').locator('.nm').click();
  await page.getByTestId('sec-rename').fill('Coffee, Tea & More');
  await page.getByTestId('sec-rename-save').click();
  await expect(page.getByTestId('sec-drinks')).toContainText('Coffee, Tea & More');
  expect((await sections()).names).toEqual({ drinks: 'Coffee, Tea & More' });

  // drag the new section from last to first
  const grip = page.getByTestId(`sec-grip-${sid}`);
  const box = (await grip.boundingBox())!;
  const row = (await page.getByTestId(`sec-${sid}`).boundingBox())!;
  await page.mouse.move(box.x + 8, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 8, box.y + box.height / 2 - row.height * 3.2, { steps: 16 });
  await page.mouse.up();
  await expect.poll(async () => (await sections()).order?.[0]).toBe(sid);
  await page.getByTestId('sec-done').click();

  // the empty section waits on the owner's list with a way to add its first dish
  await page.getByTestId(`add-to-${sid}`).click();
  await page.getByTestId('dish-name').fill('Kesari Bath');
  await page.getByTestId('dish-price').fill('79');
  await expect(page.getByTestId(`dish-cat-${sid}`)).toHaveAttribute('aria-checked', 'true'); // starts in that section
  await page.getByTestId('dish-save').click();
  await expect(page.getByTestId('dish-check')).toContainText('Sweets');
  await page.getByTestId('dish-publish').click();
  await expect(page.getByTestId(`mcat-${sid}`)).toContainText('Kesari Bath');

  // the kiosk: Sweets first with its dish, the renamed section under its new name
  const kiosk = await (await browser.newContext({ viewport: { width: 800, height: 1280 } })).newPage();
  await kiosk.goto('/kiosk');
  await kiosk.getByTestId('start').click();
  const bar = kiosk.locator('.cats .n');
  await expect(bar.first()).toHaveText('Sweets');
  await expect(bar).toContainText(['Sweets', 'Dosas', 'Idli & Vada', 'Coffee, Tea & More']);
  await expect(kiosk.getByText('Kesari Bath').first()).toBeVisible();
  await kiosk.context().close();
  const dish = ((await publicMenu(request)).custom as { id: string; name: string }[]).find(
    (c) => c.name === 'Kesari Bath',
  )!;
  expect((await orderIt(request, dish.id)).ok()).toBe(true);

  // switch the section off: it and its dish leave the kiosk and can't be ordered
  await page.getByTestId('open-add').click();
  await page.getByTestId('open-sections').click();
  await page.getByTestId(`sec-sw-${sid}`).click();
  await expect(page.getByTestId(`sec-${sid}`)).toContainText('off the kiosk');
  expect((await sections()).hidden).toEqual([sid]);
  expect((await orderIt(request, dish.id)).status()).toBe(400);
  await expect(page.getByTestId(`sec-remove-${sid}`)).toHaveText('Delete'); // it has a dish of the owner's own: deletable with it, asked twice
  await page.getByTestId('sec-done').click();
  await expect(page.getByTestId(`mcat-${sid}`)).toContainText('Section is off the kiosk');
});

test('sections API: PIN, bad input, limits, and what can and cannot be removed', async ({ request }) => {
  expect((await dishes(request, { section: { name: 'Rice' } }, {})).status()).toBe(401);
  for (const bad of [
    { section: null },
    { section: { name: '' } },
    { section: { name: 'x'.repeat(25) } },
    { section: { name: 7 } },
    { section: { name: 'dosas' } }, // already there
    { sectionOrder: ['dosa', 'dosa'] },
    { sectionOrder: ['test'] }, // the payment test is not the owner's to move
    { sectionOrder: 'dosa' },
    { dish: { cat: 's-nosuch01', name: 'Ghost', desc: '', price: 9, groups: [], photo: null } },
  ])
    expect((await dishes(request, bad)).status(), JSON.stringify(bad).slice(0, 80)).toBe(400);
  for (const b of [
    { section: { id: 's-nosuch01', name: 'X' } },
    { hideSection: 'test' },
    { showSection: 'nope' },
    { removeSection: 's-nosuch01' },
  ])
    expect((await dishes(request, b)).status(), JSON.stringify(b)).toBe(404);
  expect((await dishes(request, { removeSection: 'dosa' })).status()).toBe(409); // came with the app

  const o = await (await request.get('/api/admin/dishes', { headers: H })).json();
  const sid = o.sections.custom[0].id as string;
  expect((await dishes(request, { removeSection: sid })).status()).toBe(409); // still has a dish
  // an empty one can go
  const rice = (await (await dishes(request, { section: { name: 'Rice' } })).json()).section;
  expect((await dishes(request, { removeSection: rice.id })).ok()).toBe(true);
  // the kiosk always keeps one section
  for (const id of ['dosa', 'idli']) expect((await dishes(request, { hideSection: id })).ok()).toBe(true);
  expect((await dishes(request, { hideSection: 'drinks' })).status()).toBe(409);
  for (const id of ['dosa', 'idli']) expect((await dishes(request, { showSection: id })).ok()).toBe(true);
  // at most ten
  const made: string[] = [];
  for (let n = 0; n < 6; n++)
    made.push((await (await dishes(request, { section: { name: `Extra ${n}` } })).json()).section.id);
  expect((await dishes(request, { section: { name: 'One too many' } })).status()).toBe(400);
  for (const id of made) await dishes(request, { removeSection: id });

  // leave the menu as the other tests expect it
  await dishes(request, { section: { id: 'drinks', name: 'Coffee & Tea' } });
  await dishes(request, { sectionOrder: [] });
});

// ---- The owner's extras and kitchen notes ----
const extras = (r: APIRequestContext, data: object, headers: Record<string, string> = H) =>
  r.post('/api/admin/extras', { data, headers });
const extrasNow = async (r: APIRequestContext) =>
  ((await (await r.get('/api/admin/dishes', { headers: H })).json()).extras ?? {}) as {
    options?: Record<string, { id: string; name: string; price: number }[]>;
    dish?: Record<string, { id: string; name: string; price: number }[]>;
    comesWith?: Record<string, string>;
    notes?: { id: string; label: string }[];
    sets?: { id: string; name: string }[];
    hidden?: string[];
    hiddenNotes?: string[];
  };

test('owner edits one dish’s extras and its “comes with” line; the kiosk, the server and the kitchen follow', async ({
  page,
  request,
  browser,
}) => {
  const DISH = 'plain-benne-dosa';
  await owner(page);
  await page.getByTestId('tab-menu').click();
  await page.getByTestId(`mi-${DISH}`).locator('.open').click();
  // it starts with exactly what the kiosk offers today
  await expect(page.getByTestId('dish-with')).toHaveValue('Comes with coconut chutney and sambar');
  const names = () =>
    page.getByTestId('extra-name').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  expect(await names()).toEqual(['Extra benne', 'Extra podi', 'Extra stuffing', 'Extra sambar']);
  // rename and reprice one, remove one, add a paid one and a free one, change the line
  await page.getByTestId('extra-name').nth(1).fill('Extra gunpowder');
  await page.getByTestId('extra-price').nth(1).fill('18');
  await page.getByRole('button', { name: 'Remove Extra stuffing' }).click();
  await page.getByTestId('extra-add').click();
  await page.getByTestId('extra-name').last().fill('Extra cheese');
  await page.getByTestId('extra-price').last().fill('30');
  await page.getByTestId('extra-add').click();
  await page.getByTestId('extra-name').last().fill('Chutney on the side');
  await page.getByTestId('extra-price').last().fill('0');
  await page.getByTestId('dish-with').fill('Comes with two chutneys');
  await page.getByTestId('ed-save').click();
  await expect(page.getByTestId('edit-sheet')).toHaveCount(0);
  const list = (await extrasNow(request)).dish![DISH];
  expect(list.map((x) => [x.name, x.price])).toEqual([
    ['Extra benne', 25],
    ['Extra gunpowder', 18],
    ['Extra sambar', 20],
    ['Extra cheese', 30],
    ['Chutney on the side', 0],
  ]);
  expect(list.slice(0, 3).map((x) => x.id)).toEqual(['benne', 'podi', 'sambar']); // kept their ids
  const [cheese, side] = [list[3].id, list[4].id];

  // the kiosk's dish sheet shows this dish's list; another dosa is untouched
  const kiosk = await (await browser.newContext({ viewport: { width: 800, height: 1280 } })).newPage();
  await kiosk.goto('/kiosk');
  await kiosk.getByTestId('start').click();
  await kiosk.getByTestId(`item-${DISH}`).click();
  const sheet = kiosk.getByTestId('sheet');
  for (const t of ['Extra cheese', 'Extra gunpowder', '+₹18', 'Comes with two chutneys', 'Make it extra'])
    await expect(sheet).toContainText(t);
  await expect(sheet).not.toContainText('Extra stuffing');
  await expect(sheet).not.toContainText('coconut chutney');
  await expect(kiosk.getByTestId(`addon-${side}`)).toHaveText('Chutney on the side'); // free: a tick box, no price
  await expect(kiosk.getByTestId(`addon-${cheese}`)).toContainText('+₹30');
  await kiosk.getByTestId(`addon-${side}`).click();
  await expect(kiosk.getByTestId('add-to-order')).toContainText('₹159'); // ticking a free one costs nothing
  await sheet.getByRole('button', { name: 'Close' }).click();
  await kiosk.getByTestId('item-masala-dosa').click();
  await expect(sheet).toContainText('Extra stuffing');
  await expect(sheet).toContainText('Comes with coconut chutney and sambar');
  await expect(sheet).not.toContainText('Extra cheese');
  await kiosk.context().close();

  // the server prices it from the dish's own list; what is off the list is refused
  const place = (choices: Record<string, string[]>, itemId = DISH) =>
    request.post('/api/orders', {
      data: {
        key: `extras-${Date.now()}-${k++}`,
        type: 'takeaway',
        name: 'Extras',
        payMethod: 'cash',
        lines: [{ itemId, qty: 1, choices, notes: [] }],
      },
    });
  const set = `d-${DISH}`;
  expect((await place({ [set]: ['palya'] })).status()).toBe(400); // removed
  expect((await place({ dosaExtras: ['benne'] })).status()).toBe(400); // the shared set is no longer this dish's
  const base = (await (await place({})).json()).subtotal as number;
  const o = await (await place({ [set]: [cheese, 'podi', side] })).json();
  expect(o.subtotal).toBe(base + 30 + 18);
  expect(o.lines[0].mods.map((m: { name: string }) => m.name).sort()).toEqual([
    'Chutney on the side',
    'Extra cheese',
    'Extra gunpowder',
  ]);

  // the kitchen chit: a paid extra in green; a free choice is a request, not an addition
  await request.post(`/api/orders/${o.id}/status`, { data: { to: 'new' }, headers: H });
  const kitchen = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await kitchen.addInitScript((pin) => localStorage.setItem('benne14.staffPin', pin), PIN);
  await kitchen.goto('/kitchen');
  const chit = kitchen.getByTestId(`chit-${o.token}`);
  await expect(chit.locator('.tg.more', { hasText: 'Extra cheese' })).toBeVisible({ timeout: 8000 });
  await expect(chit.locator('.tg', { hasText: 'Chutney on the side' })).toBeVisible();
  await expect(chit.locator('.tg.more', { hasText: 'Chutney on the side' })).toHaveCount(0);
  await kitchen.context().close();

  // history says what changed, in words
  await page.getByTestId('open-history').click();
  for (const text of ['Extra cheese ₹30', 'Chutney on the side', 'Comes with two chutneys'])
    await expect(page.getByTestId('history')).toContainText(text);
});

test('owner copies a dish’s extras onto another, clears a “comes with” line, and sets the sugar choice', async ({
  page,
  request,
}) => {
  await owner(page);
  await page.getByTestId('tab-menu').click();
  // medu vada takes the idlis' extras as its own, and loses its line
  await page.getByTestId('mi-medu-vada').locator('.open').click();
  await page.getByTestId('extra-copy').click();
  await page.getByTestId('extra-copy-mallige-idli').click();
  const names = () =>
    page.getByTestId('extra-name').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  expect(await names()).toEqual(['Extra sambar', 'Extra ghee']);
  await page.getByTestId('extra-price').first().fill('10');
  await page.getByTestId('dish-with').fill('');
  await page.getByTestId('ed-save').click();
  await expect(page.getByTestId('edit-sheet')).toHaveCount(0);
  const ex = await extrasNow(request);
  expect(ex.dish!['medu-vada'].map((x) => [x.name, x.price])).toEqual([
    ['Extra sambar', 10],
    ['Extra ghee', 15],
  ]);
  expect(ex.comesWith!['medu-vada']).toBe('');
  expect(ex.dish!['mallige-idli']).toBeUndefined(); // the dish copied from is unchanged
  const menu = await publicMenu(request);
  expect(JSON.stringify(menu.extras.dish['medu-vada'])).toContain('Extra ghee');

  // the sugar choice is a switch: masala tea stops asking, then asks again
  const sugarOn = async () => {
    const o = await request.post('/api/orders', {
      data: {
        key: `sugar-${Date.now()}-${k++}`,
        type: 'takeaway',
        name: null,
        payMethod: 'cash',
        lines: [{ itemId: 'masala-tea', qty: 1, choices: { sugar: ['less'] }, notes: [] }],
      },
    });
    return o.status() === 201;
  };
  expect(await sugarOn()).toBe(true);
  for (const want of [false, true]) {
    await page.getByTestId('mi-masala-tea').locator('.open').click();
    await expect(page.getByTestId('dish-sugar')).toHaveAttribute('aria-checked', String(!want));
    await page.getByTestId('dish-sugar').click();
    await page.getByTestId('ed-save').click();
    await expect(page.getByTestId('edit-sheet')).toHaveCount(0);
    expect(await sugarOn()).toBe(want);
  }
});

test('extras API: PIN, bad input, limits, and what stays for old orders', async ({ request }) => {
  expect((await extras(request, { extra: { set: 'dosaExtras', name: 'X', price: 5 } }, {})).status()).toBe(401);
  for (const bad of [
    {},
    { extra: { set: 'dosaExtras', name: '', price: 5 } },
    { extra: { set: 'dosaExtras', name: 'x'.repeat(31), price: 5 } },
    { extra: { set: 'dosaExtras', name: 'Free lunch', price: -1 } },
    { extra: { set: 'dosaExtras', name: 'Half', price: 2.5 } },
    { extra: { set: 'dosaExtras', name: 'extra BENNE', price: 5 } }, // already there
    { set: { name: '' } },
    { dish: { itemId: 'masala-dosa' } }, // nothing to change
    { dish: { itemId: 'masala-dosa', extras: 'benne' } },
    { dish: { itemId: 'masala-dosa', extras: [{ name: '', price: 5 }] } },
    { dish: { itemId: 'masala-dosa', extras: [{ name: 'Half', price: 2.5 }] } },
    { dish: { itemId: 'masala-dosa', extras: [{ name: 'Free lunch', price: -1 }] } },
    { dish: { itemId: 'masala-dosa', extras: [{ name: 'x'.repeat(31), price: 5 }] } },
    {
      dish: {
        itemId: 'masala-dosa',
        extras: [
          { name: 'Ghee', price: 5 },
          { name: 'ghee', price: 9 },
        ],
      },
    }, // twice
    { dish: { itemId: 'masala-dosa', extras: Array.from({ length: 17 }, (_, n) => ({ name: `E${n}`, price: 1 })) } },
    { dish: { itemId: 'masala-dosa', comesWith: 'x'.repeat(81) } },
    { dish: { itemId: 'masala-dosa', comesWith: 7 } },
    { dishSets: { itemId: 'masala-dosa', sets: ['nope'] } },
    { dishSets: { itemId: 'masala-dosa', sets: 'dosaExtras' } },
    { note: { label: '', tone: 'less', cats: ['dosa'] } },
    { note: { label: 'Hot', tone: 'spicy', cats: ['dosa'] } },
    { note: { label: 'Hot', tone: null, cats: [] } },
    { note: { label: 'Hot', tone: null, cats: ['test'] } },
    { note: { label: 'potato stuffing on the side', tone: 'less', cats: ['dosa'] } }, // already there
  ])
    expect((await extras(request, bad)).status(), JSON.stringify(bad).slice(0, 90)).toBe(400);
  for (const b of [
    { extra: { set: 'sugar', name: 'Jaggery', price: 5 } }, // a choice, not a set of extras
    { extra: { set: 'nope', name: 'X', price: 5 } },
    { extra: { set: 'dosaExtras', id: 'x-nosuch01', name: 'X', price: 5 } },
    { hideExtra: 'dosaExtras:nope' },
    { showExtra: 'sugar:less' },
    { set: { id: 'g-nosuch01', name: 'X' } },
    { removeSet: 'g-nosuch01' },
    { dishSets: { itemId: 'test-1', sets: [] } },
    { note: { id: 'potato-side', label: 'Potato apart', tone: 'less', cats: ['dosa'] } }, // not the owner's own
    { hideNote: 'nope' },
    { dish: { itemId: 'no-such-dish', extras: [] } },
    { dish: { itemId: 'test-1', extras: [] } }, // the payment test is not the owner's to change
  ])
    expect((await extras(request, b)).status(), JSON.stringify(b)).toBe(404);
  expect((await extras(request, { set: { id: 'dosaExtras', name: 'Mine' } })).status()).toBe(409);
  expect((await extras(request, { removeSet: 'dosaExtras' })).status()).toBe(409);
  const full = (await (await extras(request, { set: { name: 'Add on top' } })).json()).set;
  expect((await extras(request, { extra: { set: full.id, name: 'Ice cream', price: 40 } })).ok()).toBe(true);
  expect((await extras(request, { removeSet: full.id })).status()).toBe(409); // it has an extra: old orders may show it

  // an empty set of the owner's own can go
  const spare = (await (await extras(request, { set: { name: 'Spare' } })).json()).set;
  expect((await extras(request, { removeSet: spare.id })).ok()).toBe(true);
  // at most twelve extras in a set
  const made: string[] = [];
  for (let n = 0; n < 8; n++) {
    const r = await extras(request, { extra: { set: 'dosaExtras', name: `Topping ${n}`, price: n } });
    expect(r.ok(), `topping ${n}`).toBe(true);
    made.push((await r.json()).extra.id);
  }
  expect((await extras(request, { extra: { set: 'dosaExtras', name: 'One too many', price: 1 } })).status()).toBe(400);
  for (const id of made) await extras(request, { hideExtra: `dosaExtras:${id}` });

  // leave the extras that came with the app as the other tests expect them
  await extras(request, { extra: { set: 'dosaExtras', id: 'podi', name: 'Extra podi', price: 15 } });
  await extras(request, { showExtra: 'dosaExtras:palya' });
});

// ---- The owner's changes reach every screen without breaking a customer mid-order ----
test('an extra taken off a dish while a customer has it picked leaves the dish and the screen intact', async ({
  page,
  request,
}) => {
  // plain dosa has its own list by now (an earlier test changed a price on it)
  const before = (await extrasNow(request)).dish!['plain-dosa'];
  expect(before.map((x) => x.id)).toContain('sambar');
  await page.clock.install();
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.goto('/kiosk');
  await page.getByTestId('start').click();
  // one in the cart with the extra, and the sheet open on the dish again with the extra picked
  await page.getByTestId('item-plain-dosa').click();
  await page.getByTestId('addon-sambar').click();
  await page.getByTestId('add-to-order').click();
  await page.getByTestId('item-plain-dosa').click();
  await page.getByTestId('addon-sambar').click();
  await page.getByTestId('addon-benne').click();
  const add = page.getByTestId('add-to-order');
  const withExtra = await add.innerText();
  const without = before.filter((x) => x.id !== 'sambar');
  expect((await extras(request, { dish: { itemId: 'plain-dosa', extras: without } })).ok()).toBe(true);
  await page.clock.runFor(31_000); // the kiosk asks for the menu again every half minute
  await expect(page.getByTestId('addon-sambar')).toHaveCount(0);
  await expect(page.getByTestId('addon-benne')).toHaveClass(/on/); // what is still offered stays picked
  await expect(add).not.toHaveText(withExtra); // the price dropped with the extra; nothing crashed
  await add.click();
  await page.getByTestId('cartbar').click();
  await expect(page.getByTestId('cart-line').first()).toBeVisible();
  await expect(page.locator('.kiosk')).not.toContainText('Extra sambar');
  await expect(page.locator('.kiosk')).toContainText('Extra benne');
  // and the order goes through at the price shown
  await page.getByTestId('takeaway').click();
  await page.getByTestId('continue-to-pay').click();
  await page.getByTestId('pay-cash').click();
  await counterPaid(page);
  await expect(page.getByTestId('token')).toBeVisible();
  await extras(request, { dish: { itemId: 'plain-dosa', extras: before } });
});

test('the start screen, the suggestions and the TV follow a hidden dish and a new one', async ({ page, request }) => {
  const live = ((await publicMenu(request)).custom as { id: string; name: string; photo: string | null }[]).find(
    (c) => c.name === 'Onion Benne Dosa',
  )!;
  await dishes(request, { show: live.id }); // the dish with a photo from the first dishes test
  await dishes(request, { hide: 'masala-tea' });
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.goto('/kiosk');
  const shots = () => page.locator('.mosaic img').evaluateAll((els) => els.map((e) => e.getAttribute('src') ?? ''));
  await expect.poll(async () => (await shots()).some((s) => s.includes('masala-tea'))).toBe(false); // off the menu, off the wall
  expect(await shots()).toHaveLength(9);
  // another dish on the menu took its place: the next one with a photo, or the owner's own
  expect((await shots()).some((s) => s.includes('filter-coffee') || s === live.photo)).toBe(true);
  // a dosa order is not offered the hidden tea
  await page.getByTestId('start').click();
  await page.getByTestId('item-plain-dosa').click();
  await page.getByTestId('add-to-order').click();
  await page.getByTestId('cartbar').click();
  await expect(page.locator('[data-testid^="suggest-"]').first()).toBeVisible();
  await expect(page.getByTestId('suggest-masala-tea')).toHaveCount(0);
  // the TV advertises the owner's new dish in its turn
  await page.clock.install();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/board');
  let seen = '';
  for (let i = 0; i < 12 && !seen.includes('onion benne dosa'); i++) {
    await page.clock.runFor(8_000);
    seen = (await page.locator('.promo').innerText()).toLowerCase(); // the banner prints names in capitals
  }
  expect(seen).toContain('onion benne dosa');
  await dishes(request, { show: 'masala-tea' });
  await dishes(request, { hide: live.id });
});

// ---- System: which screens are alive, and what went wrong ----
const system = async (r: APIRequestContext) =>
  (await (await r.get('/api/admin/system', { headers: H })).json()) as {
    devices: { id: string; kind: string; screen: string | null; build: string | null; seenAt: string; shop: boolean }[];
    errors: { source: string; message: string; detail: string | null }[];
    problems: { level: string; text: string }[];
    build: string;
  };

test('the technical page shows speed, grouped errors and a report to copy; it needs the owner PIN', async ({
  page,
  request,
  context,
}) => {
  expect((await request.get('/api/admin/tech')).status()).toBe(401);
  expect((await request.get('/api/admin/tech', { headers: { 'x-staff-pin': STAFF_PIN } })).status()).toBe(401);
  // an order is placed and started, and the same thing goes wrong twice on a screen
  const o = await (await order(request, 'masala-dosa')).json();
  await request.post(`/api/orders/${o.id}/status`, { data: { to: 'cooking' }, headers: H });
  const ip = { 'x-forwarded-for': '10.9.8.7' };
  for (let n = 0; n < 2; n++)
    await request.post('/api/log', {
      data: { source: 'kiosk', message: 'tech page test error', detail: 'at line 7', device: 'kiosk0000009' },
      headers: ip,
    });
  await expect
    .poll(async () => {
      const r = await (await request.get('/api/admin/tech', { headers: H })).json();
      return r.speed.map((s: { op: string }) => s.op).join(',');
    })
    .toContain('order.move');
  const r = await (await request.get('/api/admin/tech', { headers: H })).json();
  expect(r.speed.find((s: { op: string }) => s.op === 'order.place').count).toBeGreaterThan(0);
  expect(r.errors.find((e: { message: string }) => e.message === 'tech page test error').count).toBe(2);
  expect(r.db.rows.orders).toBeGreaterThan(0);
  expect(JSON.stringify(r)).not.toContain(PIN);

  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await owner(page);
  await page.getByTestId('sysline').click();
  await page.getByTestId('open-tech').click();
  const tech = page.getByTestId('tech');
  await expect(tech.getByTestId('speed-order.place')).toContainText('Placing an order');
  await expect(tech.getByTestId('speed-order.place')).toContainText('usually');
  const group = tech.getByTestId('errgroup').filter({ hasText: 'tech page test error' });
  await expect(group).toContainText('2 times');
  await group.click();
  await expect(group.locator('code')).toContainText('at line 7');
  await expect(tech.getByTestId('tech-db')).toContainText('updates run');
  await tech.getByTestId('copy-report').click();
  await expect(tech.getByTestId('copy-report')).toHaveText('Copied');
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('Benne 14 technical report');
  expect(text).toContain('x2 [kiosk] tech page test error');
  expect(text).toContain('order.place:');
  expect(text).not.toContain(PIN);
  await tech.getByRole('button', { name: 'Back to System' }).click();
  await expect(page.getByTestId('system')).toBeVisible();
});

test('the owner app shows which screens are alive, and an error a screen ran into', async ({
  page,
  request,
  browser,
}) => {
  // a kiosk and a kitchen screen open in the shop
  const kiosk = await (await browser.newContext({ viewport: { width: 800, height: 1280 } })).newPage();
  await kiosk.goto('/kiosk');
  await kiosk.getByTestId('start').click();
  const kctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await kctx.addInitScript((pin) => localStorage.setItem('benne14.staffPin', pin), PIN);
  const kitchen = await kctx.newPage();
  await kitchen.goto('/kitchen');
  await expect
    .poll(
      async () =>
        (await system(request)).devices
          .map((d) => d.kind)
          .sort()
          .join(','),
      { timeout: 10_000 },
    )
    .toContain('kiosk,kitchen');
  const sys = await system(request);
  const k = sys.devices.find((d) => d.kind === 'kiosk')!;
  expect(k.id).toMatch(/^[a-z0-9]{8,24}$/);
  expect(k.build).toBe(sys.build); // it says which version it runs

  // a screen crashes: it restarts itself, and the owner can see what happened
  const crash = await (await browser.newContext()).newPage();
  await crash.goto('/crash-test?boom=1');
  await expect(crash.getByTestId('recover')).toBeVisible();
  await expect
    .poll(async () => (await system(request)).errors.some((e) => e.message.includes('crash test')), { timeout: 8000 })
    .toBe(true);
  await crash.context().close();

  await owner(page);
  const line = page.getByTestId('sysline');
  await expect(line).toBeVisible();
  await line.click();
  const sysPage = page.getByTestId('system');
  // nothing is picked yet: each screen has its line, and the devices seen wait in the list below
  await expect(sysPage.getByTestId('dev-kiosk')).toContainText('Not picked yet');
  await expect(sysPage.getByTestId('dev-board')).toBeVisible(); // the TV has its line, connected or not
  await expect(sysPage.getByTestId('other-device').filter({ hasText: 'Online' }).first()).toBeVisible();
  const row = sysPage.getByTestId('errrow').filter({ hasText: 'crash test' }).first();
  await expect(row).toContainText('screen crashed');
  await row.click();
  await expect(row.locator('code')).toBeVisible(); // the detail, for whoever fixes it
  await kiosk.context().close();
  await kctx.close();
});

test('the owner picks the shop’s own screens and clears the rest', async ({ page, request }) => {
  const from = { 'x-forwarded-for': '10.7.7.8' };
  const beat = (id: string, kind: string) =>
    request.post('/api/beat', { data: { id, kind, screen: 'home', build: 'v' }, headers: from });
  const post = (data: object) => request.post('/api/admin/system', { data, headers: H });
  // from its own address: wrong PINs are counted per address and this file has many
  expect((await request.post('/api/admin/system', { data: { forgetOthers: true }, headers: from })).status()).toBe(401);
  for (const bad of [{}, { shop: 7 }, { shop: 'nosuchdevice1' }, { forget: 'BAD ID!' }, { forgetOthers: 'yes' }])
    expect((await post(bad)).status(), JSON.stringify(bad)).toBeGreaterThanOrEqual(400);
  await post({ forgetOthers: true });
  for (const [id, kind] of [
    ['shopkiosk001', 'kiosk'],
    ['phonekiosk01', 'kiosk'],
    ['phonekiosk02', 'kiosk'],
    ['shopkitchen1', 'kitchen'],
  ])
    expect((await beat(id, kind)).ok()).toBe(true);

  await owner(page);
  await page.getByTestId('sysline').click();
  const screens = page.getByTestId('screens');
  await expect(screens.getByTestId('dev-kiosk')).toContainText('Not picked yet');
  const kiosks = screens.getByTestId('other-device').filter({ hasText: 'Kiosk' });
  await expect(kiosks).toHaveCount(3);
  await kiosks.first().getByTestId('pick').click();
  await expect(screens.getByTestId('dev-kiosk')).toContainText('Online');
  await expect(screens.getByTestId('other-device').filter({ hasText: 'Kiosk' })).toHaveCount(2);
  let sys = await system(request);
  expect(sys.devices.filter((d) => d.kind === 'kiosk' && d.shop)).toHaveLength(1);

  // one device forgotten, then all the rest: the shop's own kiosk stays
  await screens.getByTestId('other-device').filter({ hasText: 'Kiosk' }).first().getByTestId('forget').click();
  await expect(screens.getByTestId('other-device').filter({ hasText: 'Kiosk' })).toHaveCount(1);
  await screens.getByTestId('forget-all').click();
  await screens.getByTestId('forget-all-yes').click();
  await expect(screens.getByTestId('other-devices')).toHaveCount(0, { timeout: 8000 });
  sys = await system(request);
  expect(sys.devices.filter((d) => d.shop).map((d) => d.kind)).toEqual(['kiosk']);
  // "Change" puts it back in the list
  await screens.getByTestId('unpick-kiosk').click();
  await expect(screens.getByTestId('dev-kiosk')).toContainText('Not picked yet');
});

test('system API: the page needs the PIN; the two open endpoints take only short, well-formed reports', async ({
  request,
}) => {
  expect((await request.get('/api/admin/system')).status()).toBe(401);
  // its own address: the other tests' screens share this server, and the brake counts per address
  const from = { 'x-forwarded-for': '10.7.7.7' };
  const beat = (data: unknown) => request.post('/api/beat', { data: data as object, headers: from });
  const log = (data: unknown) => request.post('/api/log', { data: data as object, headers: from });
  for (const bad of [
    {},
    { id: 'kiosk0000001' },
    { id: 'kiosk0000001', kind: 'toaster' },
    { id: 'BAD ID!', kind: 'kiosk' },
    { id: 7, kind: 'kiosk' },
  ])
    expect((await beat(bad)).status(), JSON.stringify(bad)).toBe(400);
  for (const bad of [
    {},
    { source: 'kiosk' },
    { source: 'kiosk', message: '   ' },
    { source: 'elsewhere', message: 'x' },
    { source: 'server', message: 'fake server error' },
  ])
    expect((await log(bad)).status(), JSON.stringify(bad)).toBe(400);
  // what is stored is clipped, however much is sent
  expect(
    (await beat({ id: 'tv0000000001', kind: 'board', screen: 'x'.repeat(500), build: 'y'.repeat(500) })).ok(),
  ).toBe(true);
  expect(
    (await log({ source: 'board', message: 'm'.repeat(5000), detail: 'd'.repeat(50_000), device: 'not an id' })).ok(),
  ).toBe(true);
  const sys = await system(request);
  const tv = sys.devices.find((d) => d.id === 'tv0000000001')!;
  expect(tv.screen).toHaveLength(24);
  expect(tv.build).toHaveLength(64);
  const e = sys.errors.find((x) => x.source === 'board')!;
  expect(e.message).toHaveLength(300);
  expect(e.detail).toHaveLength(2000);
  // a flood from one address is slowed down
  let refused = 0;
  for (let n = 0; n < 14; n++) if ((await log({ source: 'kiosk', message: `flood ${n}` })).status() === 429) refused++;
  expect(refused).toBeGreaterThan(0);
});

// ---- Alerts to the owner's phone ----
test('notifications API: PIN, only real push services, a test reaches every subscribed phone', async ({ request }) => {
  const push = (data: unknown, headers: Record<string, string> = H) =>
    request.post('/api/admin/push', { data: data as object, headers });
  expect((await request.get('/api/admin/push')).status()).toBe(401);
  expect((await push({ test: true }, {})).status()).toBe(401);
  const info = await (await request.get('/api/admin/push', { headers: H })).json();
  expect(info.publicKey.length).toBeGreaterThan(80); // what a phone needs to subscribe; made once
  expect((await (await request.get('/api/admin/push', { headers: H })).json()).publicKey).toBe(info.publicKey);

  const keys = { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) };
  for (const bad of [
    {},
    { subscribe: null },
    { subscribe: { endpoint: 'https://evil.example/collect', keys } }, // not a push service: the server would post to it
    { subscribe: { endpoint: 'http://fcm.googleapis.com/fcm/send/x', keys } },
    { subscribe: { endpoint: 'https://169.254.169.254/latest', keys } },
    { subscribe: { endpoint: 'https://phone1.push.invalid/x', keys: { p256dh: 'not base64 !!', auth: keys.auth } } },
    { subscribe: { endpoint: 'https://phone1.push.invalid/x' } },
    { unsubscribe: 7 },
  ])
    expect((await push(bad)).status(), JSON.stringify(bad).slice(0, 90)).toBe(400);

  expect((await (await push({ test: true })).json()).sent).toBe(0); // no phone yet
  expect((await (await push({ subscribe: { endpoint: 'https://phone1.push.invalid/x', keys } })).json()).phones).toBe(
    1,
  );
  expect((await (await push({ subscribe: { endpoint: 'https://phone1.push.invalid/x', keys } })).json()).phones).toBe(
    1,
  );
  expect((await (await push({ subscribe: { endpoint: 'https://phone2.push.invalid/y', keys } })).json()).phones).toBe(
    2,
  );
  expect((await (await push({ test: true })).json()).sent).toBe(2);
  expect((await (await push({ unsubscribe: 'https://phone1.push.invalid/x' })).json()).phones).toBe(1);
  expect((await (await push({ test: true })).json()).sent).toBe(1);

  // the check itself is open (the uptime job calls it) and says nothing about what it found
  const w = await request.get('/api/watch', { headers: { 'x-forwarded-for': '10.8.8.8' } });
  expect(w.status()).toBe(200);
  expect(await w.json()).toEqual({ ok: true });
  await push({ unsubscribe: 'https://phone2.push.invalid/y' });
});

test('the System page offers notifications for this phone and lists what was announced', async ({ page }) => {
  await owner(page);
  await page.getByTestId('sysline').click();
  const notify = page.getByTestId('notify');
  await expect(notify).toContainText('Alerts on this phone');
  await expect(notify).toContainText('Only phones where this is switched on');
  // this test browser can ask for them; whether a phone then gets one is the phone's own doing
  await expect(
    notify
      .getByTestId('notify-on')
      .or(notify.getByText('can’t show notifications'))
      .or(notify.getByText('Notifications are blocked')),
  ).toBeVisible();
});

// ---- Who may do what: the owner PIN, the staff PIN, and the kiosk's key ----
test('the kitchen’s PIN does not open the owner app; the owner PIN does everything', async ({ page, request }) => {
  const staff = { 'x-staff-pin': STAFF_PIN };
  // takings, prices, the menu, refunds, the system page: owner only
  for (const path of [
    '/api/admin/system',
    '/api/admin/events',
    '/api/admin/dishes',
    '/api/admin/offers',
    '/api/admin/push',
  ])
    expect((await request.get(path, { headers: staff })).status(), path).toBe(401);
  expect(
    (await request.post('/api/admin/menu', { data: { itemId: 'masala-tea', price: 1 }, headers: staff })).status(),
  ).toBe(401);
  expect((await request.get('/api/admin/system', { headers: H })).status()).toBe(200);
  // the kitchen still works with the staff PIN, and the owner PIN works there too
  const o = await (await order(request, 'masala-tea')).json();
  expect((await request.post(`/api/orders/${o.id}/status`, { data: { to: 'new' }, headers: staff })).ok()).toBe(true);
  expect((await request.post(`/api/orders/${o.id}/status`, { data: { to: 'cooking' }, headers: H })).ok()).toBe(true);
  expect(await (await request.get('/api/staff')).json()).toEqual({ staffDigits: 4, ownerDigits: 6 });

  // the owner app's PIN pad takes six digits and refuses the kitchen's PIN
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin');
  const gate = page.getByTestId('pin-gate');
  await expect(gate).toContainText('Enter the owner PIN');
  await expect(gate.locator('.dots i')).toHaveCount(6);
  for (const d of '246800') await gate.getByRole('button', { name: d, exact: true }).click();
  await expect(page.getByTestId('pin-msg')).toContainText('Wrong PIN');
  for (const d of PIN) await gate.getByRole('button', { name: d, exact: true }).click();
  await expect(page.getByTestId('today-slip')).toBeVisible();
  // and the System page no longer nags about the shared PIN
  const sys = await (await request.get('/api/admin/system', { headers: H })).json();
  expect(sys.problems.some((p: { key: string }) => p.key === 'ownerpin')).toBe(false);
});

test('only a tablet staff have set up can place orders; setting one up takes the staff PIN once', async ({
  browser,
  playwright,
  baseURL,
}) => {
  const body = {
    key: `locked-${Date.now()}`,
    type: 'takeaway',
    name: null,
    payMethod: 'cash',
    lines: [{ itemId: 'masala-tea', qty: 1, choices: {}, notes: [] }],
  };
  // a stranger: no key, a made-up key, a key signed with the wrong PIN
  const stranger = await playwright.request.newContext({ baseURL, extraHTTPHeaders: {} });
  expect((await stranger.post('/api/orders', { data: body })).status()).toBe(401);
  for (const key of ['k1.abcdefgh.' + 'A'.repeat(32), 'nonsense', ''])
    expect((await stranger.post('/api/orders', { data: body, headers: { 'x-kiosk-key': key } })).status()).toBe(401);
  // a key is handed out only for the staff PIN
  expect((await stranger.post('/api/kiosk')).status()).toBe(401);
  expect(
    (await stranger.post('/api/kiosk', { headers: { 'x-staff-pin': '0000', 'x-forwarded-for': '10.5.5.5' } })).status(),
  ).toBe(401);
  const { key } = await (await stranger.post('/api/kiosk', { headers: { 'x-staff-pin': STAFF_PIN } })).json();
  expect(key).toMatch(/^k1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{32}$/);
  expect((await stranger.post('/api/orders', { data: body, headers: { 'x-kiosk-key': key } })).status()).toBe(201);
  await stranger.dispose();

  // a brand-new tablet: the kiosk asks staff for the PIN once, then customers can order
  const ctx = await browser.newContext({ viewport: { width: 800, height: 1280 }, extraHTTPHeaders: {} });
  const kiosk = await ctx.newPage();
  await kiosk.goto('/kiosk');
  const setup = kiosk.getByTestId('kiosk-setup');
  await expect(setup).toContainText('Set up this kiosk');
  for (const d of STAFF_PIN) await setup.getByRole('button', { name: d, exact: true }).click();
  await expect(setup).toHaveCount(0);
  await kiosk.getByTestId('start').click();
  await kiosk.getByTestId('item-masala-tea').click();
  await kiosk.getByTestId('add-to-order').click();
  await kiosk.getByTestId('cartbar').click();
  await expect(kiosk.getByTestId('cart-line')).toHaveCount(1);
  // it stays set up after a reload
  await kiosk.reload();
  await expect(kiosk.getByTestId('start')).toBeVisible();
  await expect(kiosk.getByTestId('kiosk-setup')).toHaveCount(0);
  await ctx.close();
});

test('owner deletes a dish they added, and a section they added together with its dishes', async ({
  page,
  request,
}) => {
  const make = async (name: string, cat: string, publish = true) => {
    const r = await dishes(request, { dish: { cat, name, desc: 'For deleting', price: 2, groups: [], photo: null } });
    const id = (await r.json()).dish.id as string;
    if (publish) await dishes(request, { publish: id });
    return id;
  };
  const names = async () =>
    ((await (await request.get('/api/admin/dishes', { headers: H })).json()).custom as { name: string }[]).map(
      (c) => c.name,
    );
  // the API's own rules
  expect((await dishes(request, { delete: 'masala-dosa' })).status()).toBe(404); // came with the app: hide, not delete
  expect((await dishes(request, { delete: 'c-nosuchdish' })).status()).toBe(404);
  expect((await request.post('/api/admin/dishes', { data: { delete: 'x' } })).status()).toBe(401);

  // a dish on the menu, with its own extras: deleted from its sheet, asked twice
  const one = await make('Delete Me Dosa', 'dosa');
  expect((await extras(request, { dish: { itemId: one, extras: [{ name: 'Extra x', price: 5 }] } })).ok()).toBe(true);
  const sold = await orderIt(request, one);
  expect(sold.status()).toBe(201);
  await owner(page);
  await page.getByTestId('tab-menu').click();
  await page.getByTestId(`mi-${one}`).locator('.open').click();
  await page.getByTestId('dish-delete').click();
  await expect(page.getByTestId('dish-delete')).toContainText('Yes, delete Delete Me Dosa for good');
  await page.getByTestId('dish-delete').click();
  await expect(page.getByTestId(`mi-${one}`)).toHaveCount(0);
  expect(await names()).not.toContain('Delete Me Dosa');
  expect((await orderIt(request, one)).status()).toBe(400); // it can no longer be ordered
  expect((await extrasNow(request)).dish?.[one]).toBeUndefined(); // nothing left behind about it
  // the bill already made keeps the dish
  const bill = await (await request.get(`/api/orders/${(await sold.json()).id}`)).json();
  expect(bill.lines[0].name).toBe('Delete Me Dosa');

  // a hidden dish of the owner's own can be deleted from the Hidden list
  const two = await make('Hidden Then Gone', 'dosa');
  await dishes(request, { hide: two });
  await page.reload();
  await page.getByTestId('tab-menu').click();
  await page.getByTestId(`delete-${two}`).click();
  await expect(page.getByTestId(`delete-${two}`)).toHaveText('Yes, delete for good');
  await page.getByTestId(`delete-${two}`).click();
  await expect(page.getByTestId(`mi-${two}`)).toHaveCount(0);

  // a section the owner added, with two dishes in it (one a draft): refused without a word, then gone with them
  const sec = (await (await dishes(request, { section: { name: 'Trial section' } })).json()).section.id as string;
  await make('Trial One', sec);
  await make('Trial Two', sec, false);
  expect((await dishes(request, { removeSection: sec })).status()).toBe(409);
  expect((await dishes(request, { removeSection: 'dosa', withDishes: true })).status()).toBe(409); // came with the app
  await page.reload();
  await page.getByTestId('tab-menu').click();
  await page.getByTestId('open-add').click();
  await page.getByTestId('open-sections').click();
  await page.getByTestId(`sec-remove-${sec}`).click();
  await expect(page.getByTestId(`sec-remove-${sec}`)).toHaveText('Yes, delete it and its 2 dishes');
  await page.getByTestId(`sec-remove-${sec}`).click();
  await expect(page.getByTestId(`sec-${sec}`)).toHaveCount(0);
  const left = await names();
  expect(left).not.toContain('Trial One');
  expect(left).not.toContain('Trial Two');
  const menu = await publicMenu(request);
  expect(JSON.stringify(menu.sections ?? {})).not.toContain(sec);
  // the built-in sections show no delete at all
  await expect(page.getByTestId('sec-remove-dosa')).toHaveCount(0);
  // history says what went
  await page.getByTestId('sec-done').click();
  await page.getByTestId('open-history').click();
  for (const t of ['Deleted from the menu', 'Deleted with the section Trial section', 'Section removed'])
    await expect(page.getByTestId('history')).toContainText(t);
});

// Last in this file on purpose: it gives masala dosa its own list, which the tests above don't expect.
test('a dish given its own extras while a customer is paying: they keep their picks and the order goes through', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.goto('/kiosk');
  await page.getByTestId('start').click();
  await page.getByTestId('item-masala-dosa').click();
  await page.getByTestId('addon-benne').click();
  await page.getByTestId('note-potato-side').click();
  await page.getByTestId('add-to-order').click();
  await page.getByTestId('cartbar').click();
  await page.getByTestId('takeaway').click();
  const total = await page.getByTestId('cart-total').innerText();
  await page.getByTestId('continue-to-pay').click();
  await expect(page.getByTestId('pay-cash')).toBeVisible();

  // the owner saves the dish's own list at this moment: the same extras, the free choice among them
  const list = [
    { id: 'benne', name: 'Extra benne', price: 25 },
    { id: 'podi', name: 'Extra podi', price: 15 },
    { id: 'potato-side', name: 'Potato stuffing on the side', price: 0 },
  ];
  expect((await extras(request, { dish: { itemId: 'masala-dosa', extras: list } })).ok()).toBe(true);

  // the kiosk still holds the old menu: the server refuses, and the customer is brought back to
  // their order with everything they picked, not shown a refusal they can do nothing about
  await page.getByTestId('pay-cash').click();
  await expect(page.getByTestId('cart-note')).toContainText('The menu just changed');
  const lineText = page.getByTestId('cart-line').first();
  await expect(lineText).toContainText('Extra benne');
  await expect(lineText).toContainText('Potato stuffing on the side');
  await expect(page.getByTestId('cart-total')).toHaveText(total); // same dishes, same price
  await page.getByTestId('continue-to-pay').click();
  await page.getByTestId('pay-cash').click();
  await counterPaid(page);
  await expect(page.getByTestId('token')).toBeVisible();
  const token = await page.locator('.k-done .token .num').innerText();
  const placed = (await (await request.get('/api/orders', { headers: H })).json()) as {
    token: string;
    lines: { mods: { name: string }[]; notes: unknown[] }[];
  }[];
  const mine = placed.find((o) => o.token === token)!;
  expect(mine.lines[0].mods.map((m) => m.name).sort()).toEqual(['Extra benne', 'Potato stuffing on the side']);
  expect(mine.lines[0].notes).toEqual([]);
});
