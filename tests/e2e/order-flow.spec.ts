import { expect, test, type Page } from '@playwright/test';

const PIN = '2468';

// Safety first: these tests place orders, so they must only ever run against the in-memory store.
test.beforeAll(async ({ request }) => {
  const h = await (await request.get('/api/health')).json();
  if (h.store !== 'memory') throw new Error(`Refusing to run e2e against the ${h.store} store`);
  if (!String(h.testMode).startsWith('off'))
    throw new Error('This suite checks the real counter flow; run it with TEST_MODE=0');
});
const staff = async (page: Page) => page.addInitScript((pin) => localStorage.setItem('benne14.staffPin', pin), PIN);

test('kiosk → kitchen → TV board → phone bill', async ({ browser }) => {
  // Kiosk: Ghee Podi Benne Dosa with extra benne + two filter coffees, pay by UPI.
  const kiosk = await browser.newPage({ viewport: { width: 800, height: 1280 } });
  await kiosk.goto('/kiosk');
  await kiosk.getByTestId('start').click();
  await kiosk.getByTestId('hero').click();
  await kiosk.getByTestId('addon-benne').click();
  await kiosk.getByTestId('add-to-order').click();
  await kiosk.getByTestId('item-filter-coffee').click();
  await kiosk.getByTestId('sheet').getByRole('button', { name: '+' }).last().click(); // quantity 2
  await kiosk.getByTestId('add-to-order').click();
  await kiosk.getByTestId('cartbar').click();
  await expect(kiosk.getByTestId('cart-total')).toHaveText('₹380'); // 224 + 138 = 362, + ₹18 GST (5%, rounded to the rupee)
  await kiosk.getByPlaceholder('Your name').fill('Rahul');
  await kiosk.getByTestId('takeaway').click(); // dine in / takeaway is asked in the cart
  await kiosk.getByTestId('continue-to-pay').click();
  await kiosk.getByTestId('pay-upi').click();
  await kiosk.getByTestId('simulate-paid').click();
  const token = (await kiosk.getByTestId('token').locator('.num').textContent())!;
  expect(token).toMatch(/^\d+$/); // plain order numbers: 1, 2, 3…

  // Kitchen: the chit lands on the rail; start, then ready.
  const kitchen = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await staff(kitchen);
  await kitchen.goto('/kitchen');
  const chit = kitchen.getByTestId(`chit-${token}`);
  await expect(chit).toBeVisible({ timeout: 5000 });
  await expect(chit).toContainText('Ghee Podi Benne Dosa');
  await expect(chit.locator('.tg.more')).toHaveText('+Extra benne'); // additions in green with a +
  await kitchen.getByTestId(`go-${token}`).click(); // Start
  await expect(kitchen.getByTestId(`go-${token}`)).toContainText('Ready');

  // Board shows it cooking, then ready with the name.
  const board = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await board.goto('/board');
  await expect(board.getByTestId(`board-prep-${token}`)).toBeVisible({ timeout: 5000 });
  await kitchen.getByTestId(`go-${token}`).click(); // Ready
  await expect(board.getByTestId('board-hero')).toContainText(token, { timeout: 5000 });
  await expect(board.getByTestId('board-hero')).toContainText('Rahul');

  // Phone bill reflects it.
  const id = await kiosk.evaluate(
    () =>
      document
        .querySelector('.receipt img')
        ?.getAttribute('src')
        ?.match(/r%2F([0-9a-f-]{36})/)?.[1],
  );
  expect(id).toBeTruthy();
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await phone.goto(`/r/${id}`);
  await expect(phone.getByTestId('receipt-status')).toContainText('Ready');
  await expect(phone.getByTestId('bill-total')).toHaveText('₹380.00');
  await expect(phone.getByTestId('bill')).not.toContainText('Round off');

  // Hand it over so the next test starts with a clear board, like a real shift.
  await kitchen.getByTestId(`ready-${token}`).getByRole('button').click({ timeout: 5000 }); // Handed over
  await expect(kitchen.getByTestId(`ready-${token}`)).toHaveCount(0, { timeout: 5000 });
  await expect(board.getByTestId('board-hero')).toHaveCount(0, { timeout: 5000 });
  // …and it moves to the history: the board's Collected row and the kitchen's Today panel.
  await expect(board.getByTestId('board-done')).toContainText(token, { timeout: 15000 });
  await kitchen.getByTestId('open-history').click();
  await expect(kitchen.getByTestId(`hist-${token}`)).toContainText('Collected');
  await kitchen.getByTestId(`hist-${token}`).getByRole('button', { name: 'Back to counter' }).click();
  await expect(kitchen.getByTestId(`ready-${token}`)).toBeVisible({ timeout: 5000 });
  await kitchen.getByRole('button', { name: 'Close' }).click();
  await kitchen.getByTestId(`ready-${token}`).getByRole('button').click({ timeout: 5000 });
  await expect(kitchen.getByTestId(`ready-${token}`)).toHaveCount(0, { timeout: 5000 });
});

test('cash order waits for the counter before reaching the rail', async ({ browser }) => {
  const kiosk = await browser.newPage({ viewport: { width: 800, height: 1280 } });
  await kiosk.goto('/kiosk');
  await kiosk.getByTestId('start').click();
  await kiosk.getByTestId('item-medu-vada').click();
  await kiosk.getByTestId('add-to-order').click();
  await kiosk.getByTestId('cartbar').click();
  await kiosk.getByTestId('dine-in').click(); // dine in / takeaway is asked in the cart
  await kiosk.getByTestId('continue-to-pay').click();
  await kiosk.getByTestId('pay-cash').click();
  const token = (await kiosk.getByTestId('token').locator('.num').textContent())!;
  await expect(kiosk.locator('.paid.due')).toContainText('at the counter');

  const kitchen = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await staff(kitchen);
  await kitchen.goto('/kitchen');
  await expect(kitchen.getByTestId(`due-${token}`)).toBeVisible({ timeout: 5000 });
  await expect(kitchen.getByTestId(`chit-${token}`)).toHaveCount(0);
  await kitchen.getByTestId(`due-${token}`).getByRole('button', { name: 'Paid' }).click();
  await expect(kitchen.getByTestId(`chit-${token}`)).toBeVisible({ timeout: 5000 });
  // and the cook can take it all the way through without the chit jumping around
  await kitchen.getByTestId(`go-${token}`).click({ timeout: 5000 }); // Start
  await expect(kitchen.getByTestId(`go-${token}`)).toContainText('Ready');
  await kitchen.getByTestId(`go-${token}`).click({ timeout: 5000 }); // Ready
  await expect(kitchen.getByTestId(`ready-${token}`)).toBeVisible({ timeout: 5000 });
  await kitchen.getByTestId(`ready-${token}`).getByRole('button').click({ timeout: 5000 }); // Handed over
  await expect(kitchen.getByTestId(`ready-${token}`)).toHaveCount(0, { timeout: 5000 });
});

test('status changes need the staff PIN', async ({ request }) => {
  const r = await request.post('/api/orders/00000000-0000-0000-0000-000000000000/status', { data: { to: 'cooking' } });
  expect(r.status()).toBe(401);
});

test('kitchen PIN is checked when typed and remembered after that', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('/kitchen');
  const gate = page.getByTestId('pin-gate');
  for (const d of '1111') await gate.getByRole('button', { name: d, exact: true }).click();
  await expect(page.getByTestId('pin-msg')).toContainText('Wrong PIN');
  await expect(gate).toBeVisible();
  for (const d of PIN) await gate.getByRole('button', { name: d, exact: true }).click();
  await expect(gate).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('pin-gate')).toHaveCount(0); // not asked again
});

test("UPI: customer taps I've paid, counter confirms on the soundbox", async ({ browser }) => {
  const kiosk = await browser.newPage({ viewport: { width: 800, height: 1280 } });
  await kiosk.goto('/kiosk');
  await kiosk.getByTestId('start').click();
  await kiosk.getByTestId('item-masala-tea').click();
  await kiosk.getByTestId('add-to-order').click();
  await kiosk.getByTestId('cartbar').click();
  await kiosk.getByTestId('takeaway').click(); // dine in / takeaway is asked in the cart
  await kiosk.getByTestId('continue-to-pay').click();
  await kiosk.getByTestId('pay-upi').click();
  await expect(kiosk.locator('.qrcard img')).toBeVisible();
  const token = (await kiosk.locator('.qrcard .who small').textContent())!.match(/Order (\d+)/)![1];

  const kitchen = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await staff(kitchen);
  await kitchen.goto('/kitchen');
  await expect(kitchen.getByTestId(`due-${token}`)).toContainText('QR still open', { timeout: 5000 });

  await kiosk.getByTestId('i-paid').click();
  await expect(kiosk.locator('.paid.due')).toContainText('Checking your UPI payment');
  await expect(kitchen.getByTestId(`due-${token}`)).toContainText('listen for the soundbox', { timeout: 5000 });
  await expect(kitchen.getByTestId(`chit-${token}`)).toHaveCount(0);
  await kitchen.getByTestId(`due-${token}`).getByRole('button', { name: 'Paid' }).click();
  await expect(kitchen.getByTestId(`chit-${token}`)).toBeVisible({ timeout: 5000 });
  await expect(kiosk.locator('.paid:not(.due)')).toContainText('Payment received', { timeout: 6000 });

  // tidy up for the next test
  await kitchen.getByTestId(`go-${token}`).click();
  await kitchen.getByTestId(`go-${token}`).click({ timeout: 5000 });
  await kitchen.getByTestId(`ready-${token}`).getByRole('button').click({ timeout: 5000 });
});

test('UPI: cancelling at the kiosk clears it from the payment shelf', async ({ browser }) => {
  const kiosk = await browser.newPage({ viewport: { width: 800, height: 1280 } });
  await kiosk.goto('/kiosk');
  await kiosk.getByTestId('start').click();
  await kiosk.getByTestId('item-masala-tea').click();
  await kiosk.getByTestId('add-to-order').click();
  await kiosk.getByTestId('cartbar').click();
  await kiosk.getByTestId('takeaway').click(); // dine in / takeaway is asked in the cart
  await kiosk.getByTestId('continue-to-pay').click();
  await kiosk.getByTestId('pay-upi').click();
  const token = (await kiosk.locator('.qrcard .who small').textContent())!.match(/Order (\d+)/)![1];
  const kitchen = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await staff(kitchen);
  await kitchen.goto('/kitchen');
  await expect(kitchen.getByTestId(`due-${token}`)).toBeVisible({ timeout: 5000 });
  await kiosk.getByRole('button', { name: 'Cancel order' }).click();
  await expect(kitchen.getByTestId(`due-${token}`)).toHaveCount(0, { timeout: 5000 });
});

test('kiosk returns to the start screen by itself after the order number', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.clock.install();
  await page.goto('/kiosk');
  await page.getByTestId('start').click();
  await page.getByTestId('item-medu-vada').click();
  await page.getByTestId('add-to-order').click();
  await page.getByTestId('cartbar').click();
  await page.getByTestId('dine-in').click(); // dine in / takeaway is asked in the cart
  await page.getByTestId('continue-to-pay').click();
  await page.getByTestId('pay-cash').click();
  await expect(page.getByTestId('token')).toBeVisible();
  await expect(page.getByTestId('thanks')).toContainText(
    'Pay ₹93 at the counter and we’ll start your Udupi Medu Vada.',
  ); // matches what was ordered
  await page.clock.runFor(95_000);
  await expect(page.getByTestId('done-ask')).toHaveCount(0); // time to read the number and scan the bill
  await page.clock.runFor(7_000);
  await expect(page.getByTestId('done-ask')).toContainText('Still there?');
  await expect(page.getByTestId('token')).toBeVisible(); // the number stays in view while it asks
  await page.getByTestId('more-time').click();
  await page.clock.runFor(55_000);
  await expect(page.getByTestId('done-ask')).toHaveCount(0); // a minute more
  await page.clock.runFor(27_000);
  await expect(page.getByTestId('start')).toBeVisible(); // nobody answered: ready for the next customer
});

test('only choices that make sense: no fried-food notes on idli, no tag for a default', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.goto('/kiosk');
  await page.getByTestId('start').click();
  await page.getByTestId('item-mallige-idli').click();
  await expect(page.getByTestId('sheet')).toContainText('Make it extra');
  await expect(page.getByTestId('sheet')).not.toContainText('Note for the kitchen'); // steamed: no "less oil" / "extra crisp"
  await page.getByTestId('sheet').getByRole('button', { name: 'Close' }).click();
  await page.getByTestId('item-medu-vada').click();
  await expect(page.getByTestId('sheet')).toContainText('Extra crisp');
  await page.getByTestId('sheet').getByRole('button', { name: 'Close' }).click();
  await page.getByTestId('item-filter-coffee').click();
  await page.getByTestId('add-to-order').click(); // regular sugar, the default
  await page.getByTestId('item-masala-tea').click();
  await page.getByTestId('sheet').getByRole('button', { name: 'Less sugar' }).click();
  await page.getByTestId('add-to-order').click();
  await page.getByTestId('cartbar').click();
  await expect(page.getByTestId('cart-line').first()).not.toContainText('Regular sugar');
  await expect(page.getByTestId('cart-line').nth(1)).toContainText('Less sugar');
});

test('phone screens can be zoomed; the kiosk cannot', async ({ page }) => {
  const viewport = async (path: string) => {
    await page.goto(path);
    return page.locator('meta[name="viewport"]').getAttribute('content');
  };
  expect(await viewport('/kiosk')).toContain('maximum-scale=1');
  expect(await viewport('/admin')).toContain('user-scalable=yes');
  expect(await viewport('/r/00000000-0000-0000-0000-000000000000')).toContain('maximum-scale=5');
});

test('installable: the app icons and manifest are served', async ({ request }) => {
  const m = await (await request.get('/manifest.webmanifest')).json();
  const pngs = m.icons.filter((i: { type: string }) => i.type === 'image/png');
  expect(pngs.length).toBeGreaterThanOrEqual(3);
  for (const i of pngs) expect((await request.get(i.src)).status(), i.src).toBe(200);
  expect((await request.get('/icon.png')).status()).toBe(200); // the browser-tab icon
});

test('+ opens the dish so extras are offered; the price with GST is explained', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.goto('/kiosk');
  await page.getByTestId('start').click();
  await expect(page.locator('.k-menu .sec .gst')).toHaveText('Prices + 5% GST');
  const dosa = page.getByTestId('item-masala-dosa');
  await dosa.getByRole('button', { name: 'Add Masala Dosa' }).click();
  await expect(page.getByTestId('sheet')).toBeVisible(); // extras and notes are offered every time
  await page.getByTestId('add-to-order').click();
  await dosa.getByRole('button', { name: 'more' }).click();
  // a third one with extra benne is its own line, the two plain ones stay as they are
  await dosa.click();
  await page.getByTestId('addon-benne').click();
  await page.getByTestId('add-to-order').click();
  await expect(page.getByTestId('cartbar')).toContainText('3');
  await expect(page.getByTestId('cartbar')).toContainText('incl. GST');
  await expect(page.getByTestId('start-over')).toHaveCount(0); // the timers clear the kiosk; no button to learn
  await page.getByTestId('cartbar').click();
  await expect(page.getByTestId('cart-line')).toHaveCount(2);
  await expect(page.locator('.k-cart .rows')).toContainText('GST 5%');
  await expect(page.locator('.k-cart .rows')).not.toContainText('CGST');
});

test('an abandoned order is cleared: "Still there?" after a minute, the start screen 15 s later', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.clock.install();
  await page.goto('/kiosk');
  await page.getByTestId('start').click();
  await page.getByTestId('item-medu-vada').click();
  await page.getByTestId('add-to-order').click();
  await page.clock.runFor(55_000);
  await expect(page.locator('.k-idle')).toHaveCount(0);
  await page.clock.runFor(7_000);
  await expect(page.locator('.k-idle')).toContainText('Still there?');
  await page.getByRole('button', { name: /Yes, I.m here/ }).click();
  await expect(page.getByTestId('cartbar')).toBeVisible(); // the order is kept
  await page.clock.runFor(62_000);
  await expect(page.locator('.k-idle')).toBeVisible();
  await page.clock.runFor(16_000);
  await expect(page.getByTestId('start')).toBeVisible();
  await page.getByTestId('start').click();
  await expect(page.getByTestId('cartbar')).toHaveCount(0); // nothing left for the next customer
});

test('the cart asks dine in or takeaway before paying', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.goto('/kiosk');
  await page.getByTestId('start').click();
  await page.getByTestId('item-masala-tea').click();
  await page.getByTestId('add-to-order').click();
  await page.getByTestId('cartbar').click();
  await expect(page.getByTestId('continue-to-pay')).toBeDisabled();
  await expect(page.locator('.k-cart .more')).toContainText('Goes well with your order'); // no dosa in this order
  await page.getByTestId('takeaway').click();
  await expect(page.getByTestId('continue-to-pay')).toBeEnabled();
});

test('a busy counter shelf shrinks its cards so every ready order stays on screen', async ({ browser, request }) => {
  const tokens: string[] = [];
  for (let i = 0; i < 14; i++) {
    const o = await (
      await request.post('/api/orders', {
        data: {
          key: `busy-shelf-${i}-0001`,
          type: 'takeaway',
          name: null,
          payMethod: 'cash',
          lines: [{ itemId: 'masala-tea', qty: 1, choices: {}, notes: [] }],
        },
      })
    ).json();
    for (const to of ['new', 'cooking', 'ready'])
      await request.post(`/api/orders/${o.id}/status`, { data: { to }, headers: { 'x-staff-pin': PIN } });
    tokens.push(o.token);
  }
  const kitchen = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await staff(kitchen);
  await kitchen.goto('/kitchen');
  const pass = kitchen.getByTestId('pass');
  await expect(kitchen.getByTestId(`ready-${tokens[0]}`)).toBeVisible({ timeout: 5000 });
  expect(Number(await pass.getAttribute('data-density'))).toBeGreaterThan(0);
  expect(await pass.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true); // nothing pushed off
  await expect(kitchen.getByTestId(`ready-${tokens[0]}`)).toBeInViewport(); // the oldest one too
  for (const t of tokens) await kitchen.getByTestId(`ready-${t}`).getByRole('button').click();
  await expect(pass).toHaveAttribute('data-density', '0', { timeout: 5000 });
});

test('the ₹1 payment test item is refused when test mode is off', async ({ request }) => {
  const r = await request.post('/api/orders', {
    data: {
      key: 'off-rupee-0001',
      type: 'takeaway',
      name: null,
      payMethod: 'upi',
      lines: [{ itemId: 'test-1', qty: 1, choices: {}, notes: [] }],
    },
  });
  expect(r.status()).toBe(400);
});
