import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

// Owner dashboard. Own server (port 3103): these tests change prices and sold-out state, which
// would upset the other suites' expected totals.
const PIN = '2468';
const H = { 'x-staff-pin': PIN };

test.beforeAll(async ({ request }) => {
  const h = await (await request.get('/api/health')).json();
  if (h.store !== 'memory') throw new Error(`Refusing to run e2e against the ${h.store} store`);
});
test.describe.configure({ mode: 'serial' });

const owner = async (page: Page) => {
  await page.addInitScript((pin) => localStorage.setItem('benne14.staffPin', pin), PIN);
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
  // an extra's price saved in the same step applies to every dish that offers it
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
        lines: [{ itemId: 'masala-dosa', qty: 1, choices: { dosaExtras: ['benne'] }, notes: [] }],
      },
    })
  ).json();
  expect(withExtra.lines[0].unitPrice).toBe(219 + 30);
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
    'Date,Time,Order,Type,Payment,Items,Discount,Code,Taxable value,CGST,SGST,Total',
  );
  expect(text).toContain('Food issue');
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
  await page.getByTestId('takeaway').click();
  await page.getByTestId('phone-input').fill('98765');
  await expect(page.getByTestId('phone-error')).toBeVisible();
  await expect(page.getByTestId('continue-to-pay')).toBeDisabled();
  await page.getByTestId('phone-input').fill(PHONE);
  await page.getByTestId('continue-to-pay').click();
  await page.getByTestId('pay-cash').click();
  await expect(page.getByTestId('token')).toBeVisible();

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

test('the owner can switch the code box and the phone box off; the server then ignores both', async ({
  page,
  request,
}) => {
  await owner(page);
  await page.getByTestId('tab-offers').click();
  await page.getByTestId('set-codes').click();
  await page.getByTestId('set-phone').click();
  await expect(page.getByTestId('set-phone')).toHaveAttribute('aria-checked', 'false');
  await expect.poll(async () => (await request.get('/api/kiosk')).json()).toEqual({ codes: false, phone: false });

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
  expect(await (await request.get('/api/kiosk')).json()).toEqual({ codes: false, phone: true });
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
  await page.getByTestId('dish-save').click();

  // the check page: how customers will see it, and it is not on the kiosk yet
  const check = page.getByTestId('dish-check');
  await expect(check).toContainText('How customers will see it');
  await expect(check).toContainText('₹179');
  await expect(check).toContainText('about ₹188');
  await expect(check).toContainText('Less oil');
  const draft = (await (await request.get('/api/admin/dishes', { headers: H })).json()).custom[0];
  expect(draft).toMatchObject({
    name: 'Onion Benne Dosa',
    price: 179,
    live: false,
    cat: 'dosa',
    groups: ['dosaExtras'],
  });
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
        lines: [{ itemId: draft.id, qty: 2, choices: { dosaExtras: ['benne'] }, notes: ['less-oil'] }],
      },
    })
  ).json();
  expect(o.lines[0]).toMatchObject({ name: 'Onion Benne Dosa', qty: 2 });
  expect(o.subtotal).toBe(2 * (179 + 25));
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
  await expect(page.getByTestId(`sec-remove-${sid}`)).toHaveCount(0); // it has a dish: not removable
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
    notes?: { id: string; label: string }[];
    sets?: { id: string; name: string }[];
    hidden?: string[];
    hiddenNotes?: string[];
  };

test('owner adds an extra and a kitchen note; the kiosk offers them, the kitchen prints them in colour', async ({
  page,
  request,
  browser,
}) => {
  await owner(page);
  await page.getByTestId('tab-menu').click();
  await page.getByTestId('open-add').click();
  await page.getByTestId('open-extras').click();
  // a new extra in the dosas' set
  await page.getByTestId('x-add-dosaExtras').click();
  await expect(page.getByTestId('extras-err')).toContainText('name');
  await page.getByTestId('x-new-name-dosaExtras').fill('Extra cheese');
  await page.getByTestId('x-new-price-dosaExtras').fill('30');
  await page.getByTestId('x-add-dosaExtras').click();
  await expect(page.getByTestId('xset-dosaExtras')).toContainText('Extra cheese');
  const cheese = (await extrasNow(request)).options!.dosaExtras[0];
  expect(cheese).toMatchObject({ name: 'Extra cheese', price: 30 });
  // reprice and rename one that came with the app
  await page.getByTestId('x-dosaExtras-podi').locator('.nm').click();
  await page.getByTestId('x-edit-name').fill('Extra gunpowder');
  await page.getByTestId('x-edit-price').fill('18');
  await page.getByTestId('x-edit-save').click();
  await expect(page.getByTestId('x-dosaExtras-podi')).toContainText('Extra gunpowder');
  await expect(page.getByTestId('x-dosaExtras-podi')).toContainText('+₹18');
  // switch one off
  await page.getByTestId('x-sw-dosaExtras-palya').click();
  await expect(page.getByTestId('x-sw-dosaExtras-palya')).toHaveAttribute('aria-checked', 'false');
  // a kitchen note for dosas
  await page.getByTestId('note-new').fill('No onion');
  await page.getByTestId('note-add').click();
  await expect(page.getByTestId('extras-err')).toContainText('sections'); // must say which dishes take it
  await page.getByTestId('note-cat-dosa').click();
  await page.getByTestId('note-add').click();
  await expect(page.getByTestId('notes')).toContainText('No onion');
  const note = (await extrasNow(request)).notes![0];
  await page.getByTestId('extras-done').click();

  // the kiosk's dish sheet: new extra and note are there, the switched-off extra is not
  const kiosk = await (await browser.newContext({ viewport: { width: 800, height: 1280 } })).newPage();
  await kiosk.goto('/kiosk');
  await kiosk.getByTestId('start').click();
  await kiosk.getByTestId('item-masala-dosa').click();
  const sheet = kiosk.getByTestId('sheet');
  await expect(sheet).toContainText('Extra cheese');
  await expect(sheet).toContainText('Extra gunpowder');
  await expect(sheet).toContainText('No onion');
  await expect(sheet).not.toContainText('Extra stuffing');
  await kiosk.context().close();

  // the server prices it; a switched-off extra is refused
  const place = (choices: Record<string, string[]>, notes: string[] = []) =>
    request.post('/api/orders', {
      data: {
        key: `extras-${Date.now()}-${k++}`,
        type: 'takeaway',
        name: 'Extras',
        payMethod: 'cash',
        lines: [{ itemId: 'masala-dosa', qty: 1, choices, notes }],
      },
    });
  expect((await place({ dosaExtras: ['palya'] })).status()).toBe(400);
  const base = (await (await place({})).json()).subtotal as number;
  const o = await (await place({ dosaExtras: [cheese.id, 'podi'] }, [note.id])).json();
  expect(o.subtotal).toBe(base + 30 + 18);
  expect(o.lines[0].mods.map((m: { name: string }) => m.name).sort()).toEqual(['Extra cheese', 'Extra gunpowder']);
  expect(o.lines[0].notes).toEqual([{ id: note.id, label: 'No onion' }]);

  // the kitchen chit: the extra in green, the note in red
  await request.post(`/api/orders/${o.id}/status`, { data: { to: 'new' }, headers: H });
  const kitchen = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await kitchen.addInitScript((pin) => localStorage.setItem('benne14.staffPin', pin), PIN);
  await kitchen.goto('/kitchen');
  const chit = kitchen.getByTestId(`chit-${o.token}`);
  await expect(chit.locator('.tg.more', { hasText: 'Extra cheese' })).toBeVisible();
  await expect(chit.locator('.tg.less', { hasText: 'No onion' })).toBeVisible({ timeout: 8000 });
  await kitchen.context().close();

  // history has the changes
  await page.getByTestId('open-history').click();
  for (const text of ['Extra cheese', 'Extra gunpowder', 'Extra switched off', 'New kitchen note'])
    await expect(page.getByTestId('history')).toContainText(text);
});

test('owner makes a set of extras and gives it to a dish that had none', async ({ page, request }) => {
  await owner(page);
  await page.getByTestId('tab-menu').click();
  await page.getByTestId('open-add').click();
  await page.getByTestId('open-extras').click();
  await page.getByTestId('xset-new').fill('Add on top');
  await page.getByTestId('xset-add').click();
  const set = (await extrasNow(request)).sets![0];
  await page.getByTestId(`x-new-name-${set.id}`).fill('Ice cream');
  await page.getByTestId(`x-new-price-${set.id}`).fill('40');
  await page.getByTestId(`x-add-${set.id}`).click();
  await expect(page.getByTestId(`xset-${set.id}`)).toContainText('Ice cream');
  await page.getByTestId('extras-done').click();
  // mallige idli now offers it instead of the idli extras
  await page.getByTestId('mi-mallige-idli').locator('.open').click();
  await page.getByTestId(`dish-group-${set.id}`).click();
  await page.getByTestId('ed-save').click();
  await expect(page.getByTestId('edit-sheet')).toHaveCount(0);
  const ice = (await extrasNow(request)).options![set.id][0];
  const place = (choices: Record<string, string[]>) =>
    request.post('/api/orders', {
      data: {
        key: `sets-${Date.now()}-${k++}`,
        type: 'takeaway',
        name: null,
        payMethod: 'cash',
        lines: [{ itemId: 'mallige-idli', qty: 1, choices, notes: [] }],
      },
    });
  const plain = (await (await place({})).json()).subtotal as number;
  expect((await (await place({ [set.id]: [ice.id] })).json()).subtotal).toBe(plain + 40);
  expect((await place({ idliExtras: ['ghee'] })).status()).toBe(400); // no longer offered on this dish
  // put it back as the other tests expect
  expect((await extras(request, { dishSets: { itemId: 'mallige-idli', sets: ['idliExtras'] } })).ok()).toBe(true);
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
    { dishSets: { itemId: 'masala-dosa', sets: ['nope'] } },
    { dishSets: { itemId: 'masala-dosa', sets: 'dosaExtras' } },
    { note: { label: '', tone: 'less', cats: ['dosa'] } },
    { note: { label: 'Hot', tone: 'spicy', cats: ['dosa'] } },
    { note: { label: 'Hot', tone: null, cats: [] } },
    { note: { label: 'Hot', tone: null, cats: ['test'] } },
    { note: { label: 'less oil', tone: 'less', cats: ['dosa'] } }, // already there
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
    { note: { id: 'less-oil', label: 'Less oil please', tone: 'less', cats: ['dosa'] } }, // not the owner's own
    { hideNote: 'nope' },
  ])
    expect((await extras(request, b)).status(), JSON.stringify(b)).toBe(404);
  expect((await extras(request, { set: { id: 'dosaExtras', name: 'Mine' } })).status()).toBe(409);
  expect((await extras(request, { removeSet: 'dosaExtras' })).status()).toBe(409);
  const now = await extrasNow(request);
  expect((await extras(request, { removeSet: now.sets![0].id })).status()).toBe(409); // it has an extra: old orders may show it

  // an empty set of the owner's own can go
  const spare = (await (await extras(request, { set: { name: 'Spare' } })).json()).set;
  expect((await extras(request, { removeSet: spare.id })).ok()).toBe(true);
  // at most twelve extras in a set
  const made: string[] = [];
  for (let n = 0; n < 7; n++) {
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
test('an extra switched off while a customer has it picked leaves the dish and the screen intact', async ({
  page,
  request,
}) => {
  await page.clock.install();
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.goto('/kiosk');
  await page.getByTestId('start').click();
  // one in the cart with the extra, and the sheet open on another with the same extra picked
  await page.getByTestId('item-masala-dosa').click();
  await page.getByTestId('addon-sambar').click();
  await page.getByTestId('add-to-order').click();
  await page.getByTestId('item-plain-dosa').click();
  await page.getByTestId('addon-sambar').click();
  const add = page.getByTestId('add-to-order');
  const withExtra = await add.innerText();
  expect((await extras(request, { hideExtra: 'dosaExtras:sambar' })).ok()).toBe(true);
  await page.clock.runFor(31_000); // the kiosk asks for the menu again every half minute
  await expect(page.getByTestId('addon-sambar')).toHaveCount(0);
  await expect(add).not.toHaveText(withExtra); // the price dropped with the extra; nothing crashed
  await add.click();
  await page.getByTestId('cartbar').click();
  await expect(page.getByTestId('cart-line')).toHaveCount(2);
  await expect(page.locator('.kiosk')).not.toContainText('Extra sambhar');
  await extras(request, { showExtra: 'dosaExtras:sambar' });
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
