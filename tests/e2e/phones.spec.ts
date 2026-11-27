import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

// What people open on their own phones: the owner app and the customer's bill. This file runs
// twice, as a Pixel in Chrome and as an iPhone (Chrome on an iPhone is Safari's engine underneath,
// which is the one that differs). Real taps on a phone-sized screen; the checks are the things
// that break on phones: a screen that scrolls sideways, a button under the tab bar, a page that
// never updates, a feature the browser does not have.
const OWNER = '246810';
const H = { 'x-staff-pin': OWNER };

test.beforeAll(async ({ request }) => {
  const h = await (await request.get('/api/health')).json();
  if (h.store !== 'memory') throw new Error(`Refusing to run e2e against the ${h.store} store`);
});

let k = 0;
const order = async (r: APIRequestContext, name: string | null = null) =>
  (
    await r.post('/api/orders', {
      data: {
        key: `phone-order-${Date.now()}-${k++}`,
        type: 'dine_in',
        name,
        payMethod: 'card',
        lines: [
          { itemId: 'masala-dosa', qty: 2, choices: { dosaExtras: ['benne'] }, notes: ['potato-side'] },
          { itemId: 'filter-coffee', qty: 1, choices: { sugar: ['less'] }, notes: [] },
        ],
      },
    })
  ).json();
const move = (r: APIRequestContext, id: string, to: string) =>
  r.post(`/api/orders/${id}/status`, { data: { to }, headers: H });

// Nothing may stick out past the side of the screen: on a phone that makes the whole page wobble.
const fitsTheScreen = async (page: Page, where: string) =>
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    `${where} scrolls sideways`,
  ).toBeLessThanOrEqual(1);

// A control the thumb can reach: inside the screen and not underneath the tab bar.
const reachable = async (page: Page, testId: string) => {
  const el = page.getByTestId(testId);
  let box = { x: 0, y: 0, width: 0, height: 0 };
  // a list that has just been asked for again may redraw the control once: look until it holds still
  await expect(async () => {
    await el.scrollIntoViewIfNeeded({ timeout: 2000 });
    box = (await el.boundingBox())!;
    expect(box).toBeTruthy();
  }).toPass({ timeout: 10_000 });
  const bar = await page.locator('.adm .tabs, .adm nav').first().boundingBox();
  const size = page.viewportSize()!;
  expect(box.x, `${testId} left edge`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${testId} right edge`).toBeLessThanOrEqual(size.width + 1);
  if (bar) expect(box.y + box.height, `${testId} is clear of the tab bar`).toBeLessThanOrEqual(bar.y + 1);
};

test('the customer’s bill: right money, fits the phone, and follows the order by itself', async ({ page, request }) => {
  const o = await order(request, 'Asha');
  await page.goto(`/r/${o.id}`);
  await expect(page.getByTestId('bill-total')).toContainText(String(o.total));
  await expect(page.getByTestId('bill')).toContainText('Masala Dosa');
  await expect(page.getByTestId('bill')).toContainText('Extra benne');
  await fitsTheScreen(page, 'the bill');
  const status = page.getByTestId('receipt-status');
  const first = await status.innerText();
  for (const to of ['new', 'cooking', 'ready']) await move(request, o.id, to);
  await expect(status).not.toHaveText(first, { timeout: 15_000 }); // no reload: the page asks by itself
  await expect(status).toContainText(/ready/i);
  await move(request, o.id, 'handed_over');
  await expect(status).not.toContainText(/ready/i, { timeout: 15_000 });
  await fitsTheScreen(page, 'the bill after the order moved');
  // a customer can pinch to zoom the bill
  expect(await page.locator('meta[name="viewport"]').getAttribute('content')).not.toMatch(
    /user-scalable=no|maximum-scale=1/,
  );
});

test('a wrong bill link says so on a phone', async ({ page }) => {
  await page.goto('/r/00000000-0000-4000-8000-000000000000');
  await expect(page.getByTestId('bill-missing')).toBeVisible();
  await fitsTheScreen(page, 'the missing bill page');
});

test('the owner app: PIN typed with a thumb, then every tab works and fits the phone', async ({ page, request }) => {
  const o = await order(request, 'Ravi');
  await move(request, o.id, 'new');

  await page.goto('/admin');
  const gate = page.getByTestId('pin-gate');
  await expect(gate).toBeVisible();
  await fitsTheScreen(page, 'the PIN pad');
  for (const d of '111111') await gate.getByRole('button', { name: d, exact: true }).tap();
  await expect(page.getByTestId('pin-msg')).not.toBeEmpty(); // a wrong PIN says so, and the pad stays
  for (const d of OWNER) await gate.getByRole('button', { name: d, exact: true }).tap();
  await expect(gate).toHaveCount(0);

  // Today
  await expect(page.getByTestId('today-takings')).toContainText('₹');
  await expect(page.getByTestId('sysline')).toBeVisible();
  await fitsTheScreen(page, 'Today');

  // Orders: the order is there in full, and its sheet opens and closes
  await page.getByTestId('tab-orders').tap();
  const row = page.getByTestId(`ord-${o.token}`);
  await expect(row).toContainText('Masala Dosa');
  await fitsTheScreen(page, 'Orders');
  await row.tap();
  await expect(page.getByTestId('order-sheet')).toContainText(String(o.total));
  await fitsTheScreen(page, 'the order sheet');
  await page.keyboard.press('Escape').catch(() => {});
  await page.reload(); // a reload keeps the owner signed in on this phone
  await expect(page.getByTestId('pin-gate')).toHaveCount(0);

  // Menu: a dish goes sold out and comes back with one tap each
  await page.getByTestId('tab-menu').tap();
  await fitsTheScreen(page, 'Menu');
  await reachable(page, 'sw-masala-tea');
  await page.getByTestId('sw-masala-tea').tap();
  await expect(page.getByTestId('mi-masala-tea')).toContainText('Sold out');
  expect((await (await request.get('/api/menu')).json()).items['masala-tea'].soldOut).toBe(true);
  await page.getByTestId('sw-masala-tea').tap();
  await expect(page.getByTestId('mi-masala-tea')).not.toContainText('Sold out');

  // Offers and Reports open and fit
  await page.getByTestId('tab-offers').tap();
  await fitsTheScreen(page, 'Offers');
  await page.getByTestId('tab-reports').tap();
  await expect(page.getByTestId('gst')).toContainText('Taxable value');
  await fitsTheScreen(page, 'Reports');
  for (const r of ['range-week', 'range-month', 'range-day']) await page.getByTestId(r).tap();
  await reachable(page, 'dl-bills');
});

test('the owner app’s System and Technical pages on a phone, with or without notifications and a clipboard', async ({
  page,
}) => {
  await page.addInitScript((pin) => localStorage.setItem('benne14.ownerPin', pin), OWNER);
  await page.goto('/admin');
  await page.getByTestId('sysline').tap();
  const sys = page.getByTestId('system');
  await expect(sys.getByTestId('problems')).toBeVisible();
  await expect(sys.getByTestId('dev-kiosk').first()).toBeVisible();
  await fitsTheScreen(page, 'System');
  // Notifications: this phone either offers to turn them on, or says plainly why it cannot. Never a blank.
  await expect(sys.getByText(/Turn on notifications|can’t show notifications yet|blocked for this site/)).toBeVisible();

  await reachable(page, 'open-tech');
  await page.getByTestId('open-tech').tap();
  const tech = page.getByTestId('tech');
  await expect(tech.getByTestId('tech-db')).toBeVisible();
  await fitsTheScreen(page, 'Technical');
  // Copy report: copied where the phone allows it, otherwise shown as text to copy by hand
  await tech.getByTestId('copy-report').tap();
  await expect(tech.getByText('Copied').or(tech.getByTestId('report-text'))).toBeVisible();
  if (await tech.getByTestId('report-text').count())
    await expect(tech.getByTestId('report-text')).toHaveValue(/Benne 14 technical report/);
  await fitsTheScreen(page, 'Technical with the report shown');
  await tech.getByRole('button', { name: 'Back to System' }).tap();
  await expect(page.getByTestId('system')).toBeVisible();
});
