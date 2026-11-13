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
  expect(text.split('\r\n')[0]).toContain('Date,Time,Order,Type,Payment,Items,Subtotal,CGST,SGST,Total');
  expect(text).toContain('Food issue');
});

test('the kiosk keeps working with the last menu if the menu can’t load', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.route('**/api/menu', (r) => r.abort('internetdisconnected'));
  await page.goto('/kiosk');
  await page.getByTestId('start').click();
  await expect(page.getByTestId('item-masala-dosa')).toContainText('₹209');
});
