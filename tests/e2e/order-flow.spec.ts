import { expect, test, type Page } from '@playwright/test';

const PIN = '2468';

// Safety first: these tests place orders, so they must only ever run against the in-memory store.
test.beforeAll(async ({ request }) => {
  const h = await (await request.get('/api/health')).json();
  if (h.store !== 'memory') throw new Error(`Refusing to run e2e against the ${h.store} store`);
  if (!String(h.testMode).startsWith('off')) throw new Error('This suite checks the real counter flow; run it with TEST_MODE=0');
});
const staff = async (page: Page) => page.addInitScript((pin) => localStorage.setItem('benne14.staffPin', pin), PIN);

test('kiosk → kitchen → TV board → phone bill', async ({ browser }) => {
  // Kiosk: Ghee Podi Benne Dosa with extra benne + two filter coffees, pay by UPI.
  const kiosk = await browser.newPage({ viewport: { width: 800, height: 1280 } });
  await kiosk.goto('/kiosk');
  await kiosk.getByTestId('takeaway').click();
  await kiosk.getByTestId('hero').click();
  await kiosk.getByTestId('addon-benne').click();
  await kiosk.getByTestId('add-to-order').click();
  await kiosk.getByTestId('item-filter-coffee').click();
  await kiosk.getByTestId('sheet').getByRole('button', { name: '+' }).last().click(); // quantity 2
  await kiosk.getByTestId('add-to-order').click();
  await kiosk.getByTestId('cartbar').click();
  await expect(kiosk.getByTestId('cart-total')).toHaveText('₹330'); // 196 + 118, + 5% GST
  await kiosk.getByPlaceholder('Your name').fill('Rahul');
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
  const id = await kiosk.evaluate(() => document.querySelector('.receipt img')?.getAttribute('src')?.match(/r%2F([0-9a-f-]{36})/)?.[1]);
  expect(id).toBeTruthy();
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await phone.goto(`/r/${id}`);
  await expect(phone.getByTestId('receipt-status')).toContainText('Ready');
  await expect(phone.getByTestId('bill-total')).toHaveText('₹330.00');
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
  await kiosk.getByTestId('dine-in').click();
  await kiosk.getByTestId('item-medu-vada').click();
  await kiosk.getByTestId('add-to-order').click();
  await kiosk.getByTestId('cartbar').click();
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
  await kiosk.getByTestId('takeaway').click();
  await kiosk.getByTestId('item-masala-tea').click();
  await kiosk.getByTestId('add-to-order').click();
  await kiosk.getByTestId('cartbar').click();
  await kiosk.getByTestId('continue-to-pay').click();
  await kiosk.getByTestId('pay-upi').click();
  await expect(kiosk.locator('.qrcard img')).toBeVisible();
  const token = (await kiosk.locator('.qrcard .who small').textContent())!.match(/Order (\d+)/)![1];

  const kitchen = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await staff(kitchen);
  await kitchen.goto('/kitchen');
  await expect(kitchen.getByTestId(`due-${token}`)).toContainText('QR still open', { timeout: 5000 });

  await kiosk.getByTestId('i-paid').click();
  await expect(kiosk.locator('.paid.due')).toContainText('being checked');
  await expect(kitchen.getByTestId(`due-${token}`)).toContainText('listen for the soundbox', { timeout: 5000 });
  await expect(kitchen.getByTestId(`chit-${token}`)).toHaveCount(0);
  await kitchen.getByTestId(`due-${token}`).getByRole('button', { name: 'Paid' }).click();
  await expect(kitchen.getByTestId(`chit-${token}`)).toBeVisible({ timeout: 5000 });
  await expect(kiosk.locator('.paid:not(.due)')).toContainText('Payment received', { timeout: 6000 });

  // tidy up for the next test
  await kitchen.getByTestId(`go-${token}`).click(); await kitchen.getByTestId(`go-${token}`).click({ timeout: 5000 });
  await kitchen.getByTestId(`ready-${token}`).getByRole('button').click({ timeout: 5000 });
});

test('UPI: cancelling at the kiosk clears it from the payment shelf', async ({ browser }) => {
  const kiosk = await browser.newPage({ viewport: { width: 800, height: 1280 } });
  await kiosk.goto('/kiosk');
  await kiosk.getByTestId('takeaway').click();
  await kiosk.getByTestId('item-masala-tea').click();
  await kiosk.getByTestId('add-to-order').click();
  await kiosk.getByTestId('cartbar').click();
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
  await page.getByTestId('dine-in').click();
  await page.getByTestId('item-medu-vada').click();
  await page.getByTestId('add-to-order').click();
  await page.getByTestId('cartbar').click();
  await page.getByTestId('continue-to-pay').click();
  await page.getByTestId('pay-cash').click();
  await expect(page.getByTestId('token')).toBeVisible();
  await page.clock.runFor(16_000);
  await expect(page.getByTestId('dine-in')).toBeVisible();
});

test('the ₹1 payment test item is refused when test mode is off', async ({ request }) => {
  const r = await request.post('/api/orders', { data: { key: 'off-rupee-0001', type: 'takeaway', name: null, payMethod: 'upi', lines: [{ itemId: 'test-1', qty: 1, choices: {}, notes: [] }] } });
  expect(r.status()).toBe(400);
});

