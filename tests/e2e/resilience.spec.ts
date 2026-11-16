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
const todayCount = async (page: Page) =>
  (await (await page.request.get('/api/orders?view=today')).json()).length as number;

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
  await page.route(
    '**/api/orders',
    (r) => (r.request().method() === 'POST' ? r.fulfill({ status: 500, body: '{"error":"boom"}' }) : r.continue()),
    { times: 1 },
  );
  await page.getByTestId('pay-cash').click();
  await expect(page.getByText("Your order didn't go through")).toBeVisible();
  await expect(page.getByText('boom')).toHaveCount(0); // no technical text for customers
  await page.getByTestId('pay-cash').click();
  await expect(page.getByTestId('token')).toBeVisible();
  expect(await todayCount(page)).toBe(before + 1);
});

test('kiosk: if the reply is lost after the order was saved, retrying gives the same order number', async ({
  page,
}) => {
  await kioskTo(page);
  await page.getByTestId('takeaway').click();
  await page.getByTestId('continue-to-pay').click();
  const before = await todayCount(page);
  // The server receives and saves the order, but the answer never reaches the tablet
  await page.route(
    '**/api/orders',
    async (r) => {
      if (r.request().method() !== 'POST') return r.continue();
      await r.fetch();
      await r.abort('connectionreset');
    },
    { times: 1 },
  );
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
  const o = await (
    await page.request.post('/api/orders', {
      data: {
        key: `res-${Date.now()}`,
        type: 'takeaway',
        name: null,
        payMethod: 'cash',
        lines: [{ itemId: 'plain-dosa', qty: 1, choices: {}, notes: [] }],
      },
    })
  ).json();
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
  await page.clock.runFor(62_000);
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
  const o = (await (await page.request.get('/api/orders?view=today')).json()).find(
    (x: { token: string }) => x.token === token,
  );
  expect(o.status).toBe('cancelled');
});

test('phone bill: a wrong link says so instead of loading forever', async ({ page }) => {
  await page.goto('/r/00000000-0000-0000-0000-000000000000');
  await expect(page.getByTestId('bill-missing')).toBeVisible({ timeout: 8000 });
});

test('kiosk: if a discount code can’t be checked, the cart says so and the order still goes through', async ({
  page,
}) => {
  await page.route('**/api/kiosk', (r) => r.fulfill({ json: { codes: true, phone: true } }));
  await page.route('**/api/discounts/check', (r) => r.abort());
  await kioskTo(page);
  const before = await todayCount(page);
  await page.getByTestId('code-input').fill('WELCOME10');
  await page.getByTestId('code-apply').click();
  await expect(page.getByTestId('code-error')).toContainText('Couldn’t check the code');
  await expect(page.getByTestId('discount-row')).toHaveCount(0);
  await page.getByTestId('takeaway').click();
  await page.getByTestId('continue-to-pay').click();
  await page.getByTestId('pay-cash').click();
  await expect(page.getByTestId('token')).toBeVisible();
  expect(await todayCount(page)).toBe(before + 1);
});

test('kiosk: reply lost, then the customer changes the order: the kitchen gets the new one only', async ({ page }) => {
  await kioskTo(page);
  await page.getByTestId('takeaway').click();
  await page.getByTestId('continue-to-pay').click();
  const before = await todayCount(page);
  await page.route(
    '**/api/orders',
    async (r) => {
      if (r.request().method() !== 'POST') return r.continue();
      await r.fetch(); // saved on the server…
      await r.abort('connectionreset'); // …but the tablet never hears
    },
    { times: 1 },
  );
  await page.getByTestId('pay-upi').click();
  await expect(page.getByText("Your order didn't go through")).toBeVisible();
  // back to the cart: one more tea, and cash instead of UPI
  await page.locator('.k-pay .back').click();
  await page.locator('.k-cart .step button').last().click();
  await page.getByTestId('continue-to-pay').click();
  await page.getByTestId('pay-cash').click();
  await expect(page.getByTestId('token')).toBeVisible();
  const today = await (await page.request.get('/api/orders?view=today')).json();
  expect(today.length).toBe(before + 2);
  expect(today[0]).toMatchObject({ payMethod: 'cash', itemCount: 2 }); // what the customer finally ordered
  expect(today[1]).toMatchObject({ payMethod: 'upi', itemCount: 1, status: 'cancelled' }); // the lost one is withdrawn
  await expect(page.locator('.k-done .token .num')).toHaveText(today[0].token);
});

test('kiosk: a price changed while the customer was paying is shown before anything is charged', async ({ page }) => {
  await kioskTo(page);
  await page.getByTestId('takeaway').click();
  await page.getByTestId('continue-to-pay').click();
  const before = await todayCount(page);
  // the kiosk believes an older, cheaper menu: the server's total differs from what the screen shows
  await page.route('**/api/orders', async (r) => {
    if (r.request().method() !== 'POST') return r.continue();
    const body = r.request().postDataJSON();
    await r.continue({ postData: JSON.stringify({ ...body, expectTotal: body.expectTotal - 5 }) });
  });
  await page.getByTestId('pay-cash').click();
  await expect(page.locator('.k-pay .err')).toContainText('Prices just changed');
  expect(await todayCount(page)).toBe(before); // nothing was placed at the unseen price
});

// ---- Screens that look after themselves ----
test('kiosk: when the shop cannot take orders, customers are sent to the counter; it comes back by itself', async ({
  page,
}) => {
  await page.clock.install();
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.goto('/kiosk');
  await expect(page.getByTestId('start')).toBeVisible();
  await expect(page.getByTestId('counter-please')).toHaveCount(0);
  await page.route('**/api/ping', (r) => r.abort('internetdisconnected'));
  await page.clock.runFor(11_000); // one failed answer could be a blip
  await expect(page.getByTestId('counter-please')).toHaveCount(0);
  await page.clock.runFor(25_000);
  await expect(page.getByTestId('counter-please')).toContainText('at the counter');
  // the database being down looks the same as no Wi-Fi
  await page.unroute('**/api/ping');
  await page.route('**/api/ping', (r) => r.fulfill({ status: 503, json: { ok: false } }));
  await page.clock.runFor(20_000);
  await expect(page.getByTestId('counter-please')).toBeVisible();
  await page.unroute('**/api/ping');
  await page.clock.runFor(20_000);
  await expect(page.getByTestId('counter-please')).toHaveCount(0);
  await page.getByTestId('start').click(); // and ordering works again
  await expect(page.getByTestId('item-masala-tea')).toBeVisible();
});

test('kiosk: a slow moment while an order is being placed never flashes "order at the counter"', async ({ page }) => {
  await page.clock.install();
  await kioskTo(page);
  await page.getByTestId('takeaway').click();
  await page.getByTestId('continue-to-pay').click();
  // the server answers nothing for a while: the order is held, and the "are you there?" checks fail
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  await page.route('**/api/orders', async (r) => {
    if (r.request().method() !== 'POST') return r.continue();
    await held;
    await r.continue();
  });
  await page.route('**/api/ping', (r) => r.abort('internetdisconnected'));
  await page.getByTestId('pay-cash').click();
  await page.clock.runFor(11_000); // well under the 12 s an order may take, long enough for the checks to fail
  await expect(page.getByTestId('counter-please')).toHaveCount(0); // the customer still sees their own order going through
  await expect(page.getByTestId('pay-cash')).toBeDisabled();
  release();
  await expect(page.getByTestId('token')).toBeVisible(); // straight to the order number, no detour
  await expect(page.getByTestId('counter-please')).toHaveCount(0);
});

test('kiosk: two failed checks in the same second (a tablet waking up) are not an outage', async ({ page }) => {
  await page.clock.install();
  await page.setViewportSize({ width: 800, height: 1280 });
  // the kiosk's first check, on opening, gets its answer before anything goes wrong
  const firstCheck = page.waitForResponse('**/api/ping');
  await page.goto('/kiosk');
  await expect(page.getByTestId('start')).toBeVisible();
  await firstCheck;
  let pings = 0;
  await page.route('**/api/ping', (r) => {
    pings++;
    return r.abort('internetdisconnected');
  });
  // the tablet wakes: the browser says "online" twice before the Wi-Fi really is
  await page.evaluate(() => {
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('online'));
  });
  await expect.poll(() => pings).toBeGreaterThanOrEqual(2);
  await page.clock.runFor(1000);
  await expect(page.getByTestId('counter-please')).toHaveCount(0);
  await page.clock.runFor(25_000); // still nothing after that: now it is an outage
  await expect(page.getByTestId('counter-please')).toBeVisible();
});

test('kiosk: a customer mid-order keeps their cart through an outage', async ({ page }) => {
  await page.clock.install();
  await kioskTo(page);
  await expect(page.getByTestId('cart-line')).toHaveCount(1);
  await page.route('**/api/ping', (r) => r.abort('internetdisconnected'));
  await page.clock.runFor(36_000);
  await expect(page.getByTestId('counter-please')).toBeVisible();
  await page.unroute('**/api/ping');
  await page.clock.runFor(20_000);
  await expect(page.getByTestId('counter-please')).toHaveCount(0);
  await expect(page.getByTestId('cart-line')).toHaveCount(1);
});

test('the ping answers plainly and says nothing else', async ({ request }) => {
  const r = await request.get('/api/ping');
  expect(r.status()).toBe(200);
  expect(await r.json()).toEqual({ ok: true });
});

test('kitchen: twenty seconds without a connection says loudly that orders are not arriving', async ({ page }) => {
  await staff(page);
  await page.clock.install();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/kitchen');
  await page.route('**/api/orders', (r) => r.abort('internetdisconnected'));
  await page.clock.runFor(8_000);
  await expect(page.getByText('No internet, reconnecting')).toBeVisible();
  await expect(page.getByTestId('netdown')).toHaveCount(0); // a short blip stays a small note
  await page.clock.runFor(22_000);
  await expect(page.getByTestId('netdown')).toContainText('new orders are NOT arriving');
  await page.unroute('**/api/orders');
  await page.clock.runFor(10_000);
  await expect(page.getByTestId('netdown')).toHaveCount(0);
});

test('kitchen: a new order nobody has started for three minutes flashes; starting it stops that', async ({
  page,
  request,
}) => {
  const o = await (
    await request.post('/api/orders', {
      data: {
        key: `unstarted-${Date.now()}`,
        type: 'takeaway',
        name: null,
        payMethod: 'cash',
        lines: [{ itemId: 'masala-tea', qty: 1, choices: {}, notes: [] }],
      },
    })
  ).json();
  await request.post(`/api/orders/${o.id}/status`, { data: { to: 'new' }, headers: { 'x-staff-pin': PIN } });
  await staff(page);
  await page.clock.install();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/kitchen');
  const chit = page.getByTestId(`chit-${o.token}`);
  await expect(chit).toBeVisible();
  await expect(chit).not.toHaveClass(/waiting/);
  await page.clock.runFor(3 * 60_000 + 20_000);
  await expect(chit).toHaveClass(/waiting/);
  await page.getByTestId(`go-${o.token}`).click();
  await expect(chit).not.toHaveClass(/waiting/);
});

test('staff can restart any screen by holding the logo for five seconds', async ({ page }) => {
  await staff(page);
  for (const [path, size] of [
    ['/kiosk', { width: 800, height: 1280 }],
    ['/kitchen', { width: 1280, height: 800 }],
    ['/board', { width: 1920, height: 1080 }],
  ] as const) {
    await page.setViewportSize(size);
    await page.goto(path);
    const logo = page.locator('.logo').first();
    await expect(logo).toBeVisible();
    await page.evaluate(() => ((window as unknown as { mark?: boolean }).mark = true));
    await logo.dispatchEvent('pointerdown');
    await page.waitForTimeout(1500);
    await logo.dispatchEvent('pointerup'); // a short press does nothing
    expect(await page.evaluate(() => (window as unknown as { mark?: boolean }).mark)).toBe(true);
    await logo.dispatchEvent('pointerdown');
    // The page reloads under us: a look that lands mid-reload throws, so count it as "not yet".
    await expect
      .poll(
        () => page.evaluate(() => (window as unknown as { mark?: boolean }).mark).catch(() => 'reloading' as const),
        { timeout: 9000 },
      )
      .toBeUndefined();
  }
});

test('a screen that crashes says "One moment" and starts again by itself, but never loops', async ({ page }) => {
  await page.goto('/crash-test');
  await expect(page.getByTestId('crash-ok')).toBeVisible();
  await page.clock.install();
  await page.goto('/crash-test?boom=1');
  await expect(page.getByTestId('recover')).toContainText('One moment');
  await page.clock.runFor(4500); // it reloads itself…
  await expect(page.getByTestId('recover')).toContainText('One moment'); // …into the same crash
  await page.clock.runFor(4500);
  // third crash within a minute: stop reloading and ask for staff
  await expect(page.getByTestId('recover')).toContainText('needs a hand');
  await expect(page.getByTestId('recover-reload')).toBeVisible();
});
