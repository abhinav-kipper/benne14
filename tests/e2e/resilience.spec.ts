import { expect, test, type Page } from '@playwright/test';

// What happens when the shop's Wi-Fi drops, a request fails half-way, or a customer walks away.
const PIN = '2468';
const staff = async (page: Page) => page.addInitScript((pin) => localStorage.setItem('benne14.staffPin', pin), PIN);
const kioskTo = async (page: Page, itemId = 'masala-tea') => {
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.goto('/kiosk');
  await page.getByTestId('start').click();
  await page.getByTestId(`item-${itemId}`).click();
  await page.getByTestId('add-to-order').click();
  await page.getByTestId('cartbar').click();
};
const todayCount = async (page: Page) => (await (await page.request.get('/api/orders?view=today')).json()).length as number;

test('kitchen shows when it is offline and recovers by itself', async ({ page }) => {
  await staff(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/kitchen');
  await expect(page.getByText('No internet, reconnecting')).toHaveCount(0);
  await page.route('**/api/orders', (r) => r.abort('internetdisconnected'));
  await expect(page.getByText('No internet, reconnecting')).toBeVisible({ timeout: 5000 });
  await page.unroute('**/api/orders');
  await expect(page.getByText('No internet, reconnecting')).toHaveCount(0, { timeout: 5000 });
});

test('TV board shows when it is offline and recovers by itself', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/board');
  await page.route('**/api/orders', (r) => r.abort('internetdisconnected'));
  await expect(page.getByText('reconnecting')).toBeVisible({ timeout: 5000 });
  await page.unroute('**/api/orders');
  await expect(page.getByText('reconnecting')).toHaveCount(0, { timeout: 5000 });
});

test('kiosk: a failed checkout shows a calm message, and trying again makes one order', async ({ page }) => {
  await kioskTo(page);
  await page.getByTestId('takeaway').click();
  await page.getByTestId('continue-to-pay').click();
  const before = await todayCount(page);
  await page.route('**/api/orders', (r) => (r.request().method() === 'POST' ? r.fulfill({ status: 500, body: '{"error":"boom"}' }) : r.continue()), { times: 1 });
  await page.getByTestId('pay-cash').click();
  await expect(page.getByText("Your order didn't go through")).toBeVisible();
  await expect(page.getByText('boom')).toHaveCount(0); // no technical text for customers
  await page.getByTestId('pay-cash').click();
  await expect(page.getByTestId('token')).toBeVisible();
  expect(await todayCount(page)).toBe(before + 1);
});

test('kiosk: if the reply is lost after the order was saved, retrying gives the same order number', async ({ page }) => {
  await kioskTo(page);
  await page.getByTestId('takeaway').click();
  await page.getByTestId('continue-to-pay').click();
  const before = await todayCount(page);
  // The server receives and saves the order, but the answer never reaches the tablet
  await page.route('**/api/orders', async (r) => {
    if (r.request().method() !== 'POST') return r.continue();
    await r.fetch();
    await r.abort('connectionreset');
  }, { times: 1 });
  await page.getByTestId('pay-cash').click();
  await expect(page.getByText("Your order didn't go through")).toBeVisible();
  expect(await todayCount(page)).toBe(before + 1);
  await page.getByTestId('pay-cash').click();
  await expect(page.getByTestId('token')).toBeVisible();
  expect(await todayCount(page)).toBe(before + 1); // same checkout key → same order, not a duplicate
});

test('kiosk: a double tap on a payment button places one order', async ({ page }) => {
  await kioskTo(page);
  await page.getByTestId('takeaway').click();
  await page.getByTestId('continue-to-pay').click();
  const before = await todayCount(page);
  await page.getByTestId('pay-cash').dblclick();
  await expect(page.getByTestId('token')).toBeVisible();
  expect(await todayCount(page)).toBe(before + 1);
});

test('kitchen: a tap that fails offline says so, and the chit stays where it was', async ({ page }) => {
  const o = await (await page.request.post('/api/orders', { data: { key: `res-${Date.now()}`, type: 'takeaway', name: null, payMethod: 'cash', lines: [{ itemId: 'plain-dosa', qty: 1, choices: {}, notes: [] }] } })).json();
  await page.request.post(`/api/orders/${o.id}/status`, { data: { to: 'new' }, headers: { 'x-staff-pin': PIN } });
  await staff(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/kitchen');
  const go = page.getByTestId(`go-${o.token}`);
  await expect(go).toContainText('Start', { timeout: 5000 });
  await page.route('**/status', (r) => r.abort('internetdisconnected'));
  await go.click();
  await expect(page.locator('.toast.err')).toContainText('No internet');
  await expect(go).toContainText('Start', { timeout: 5000 }); // back to the real state after the next poll
  expect((await (await page.request.get(`/api/orders/${o.id}`)).json()).status).toBe('new');
  await page.unroute('**/status');
  await go.click();
  await expect(go).toContainText('Ready');
});

test('kiosk: a customer who walks away mid-order is asked, then the kiosk starts fresh', async ({ page }) => {
  await page.clock.install();
  await kioskTo(page);
  await page.clock.runFor(76_000);
  await expect(page.getByText('Still there?')).toBeVisible();
  await page.clock.runFor(16_000);
  await expect(page.getByTestId('start')).toBeVisible();
  await page.getByTestId('start').click();
  await expect(page.getByTestId('cartbar')).toHaveCount(0); // cart was cleared
});

test('kiosk: an unpaid UPI QR expires after 5 minutes and frees the order', async ({ page }) => {
  await page.clock.install();
  await kioskTo(page);
  await page.getByTestId('takeaway').click();
  await page.getByTestId('continue-to-pay').click();
  await page.getByTestId('pay-upi').click();
  const token = (await page.locator('.qrcard .who small').textContent())!.match(/Order (\d+)/)![1];
  await page.clock.runFor(301_000);
  await expect(page.getByTestId('start')).toBeVisible();
  const o = (await (await page.request.get('/api/orders?view=today')).json()).find((x: { token: string }) => x.token === token);
  expect(o.status).toBe('cancelled');
});

test('phone bill: a wrong link says so instead of loading forever', async ({ page }) => {
  await page.goto('/r/00000000-0000-0000-0000-000000000000');
  await expect(page.getByTestId('bill-missing')).toBeVisible({ timeout: 8000 });
});
