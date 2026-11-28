import { expect, test, type Page } from '@playwright/test';
import { counterPaid } from '../support/kiosk';

const PIN = '2468';
const H = { 'x-staff-pin': PIN };

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
  await expect(kiosk.getByTestId('cart-total')).toHaveText('₹380'); // 224 + 138 = 362, + ₹18.10 GST = 380.10, rounded
  await expect(kiosk.locator('.k-cart .rows')).toContainText('₹18.10'); // the tax to the paisa
  await expect(kiosk.getByTestId('round-off')).toContainText('−₹0.10'); // and what rounding the total took
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
  await expect(chit.locator('.min')).toContainText('min'); // minutes waiting, spelled out
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
  await expect(phone.getByTestId('bill')).toContainText('₹9.05'); // CGST and SGST, each to the paisa
  await expect(phone.getByTestId('bill')).toContainText('Round off');
  await expect(phone.getByTestId('bill')).toContainText('−₹0.10');

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

test('the phone bill becomes a tax invoice when the order is paid, with the shop’s GSTIN and FSSAI number', async ({
  page,
  request,
}) => {
  const place = async (n: number) =>
    (
      await request.post('/api/orders', {
        data: {
          key: `invoice-bill-${Date.now()}-${n}`,
          type: 'takeaway',
          name: null,
          payMethod: 'card',
          lines: [{ itemId: 'masala-dosa', qty: 1, choices: {}, notes: [] }],
        },
      })
    ).json();
  const pay = (id: string) => request.post(`/api/orders/${id}/status`, { data: { to: 'new' }, headers: H });
  const first = await place(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/r/${first.id}`);
  // before payment it is a bill: who it is from is already there, an invoice number is not
  await expect(page.getByTestId('bill-title')).toHaveText('Bill');
  await expect(page.getByTestId('bill-invoice')).toHaveCount(0);
  const from = page.getByTestId('bill-from');
  await expect(from).toContainText('benne 14');
  await expect(from).toContainText('Shop No. 1, Plot No. 15');
  await expect(from).toContainText('Ghaziabad, Uttar Pradesh 201014');
  await expect(from).toContainText('GSTIN 09HQSPM1340E1ZM');
  await expect(from).toContainText('FSSAI Reg. No. 22726105001944');
  await pay(first.id);
  await expect(page.getByTestId('bill-title')).toHaveText('Tax invoice', { timeout: 10_000 }); // by itself
  const no = (await page.getByTestId('bill-invoice').innerText()).replace('No. ', '');
  expect(no).toMatch(/^B14\/\d\d-\d\d\/\d{6}$/);
  expect(no.length).toBeLessThanOrEqual(16);
  await expect(page.getByTestId('bill')).toContainText('CGST @ 2.5%');
  await expect(page.getByTestId('bill')).toContainText('SAC 9963');
  await expect(page.getByTestId('bill')).toContainText('Place of supply: Uttar Pradesh (09)');
  await expect(page.locator('.rcpt .foot')).toContainText('+91 74286 71414');
  await expect(page.locator('.rcpt .foot')).toContainText('computer-generated invoice');
  // the next paid order gets the next number; one that is never paid uses none up
  const walked = await place(2);
  await request.post(`/api/orders/${walked.id}/status`, { data: { to: 'cancelled' }, headers: H });
  const second = await place(3);
  const paid = await (await pay(second.id)).json();
  expect(+paid.invoiceNo.slice(-6)).toBe(+no.slice(-6) + 1);
  expect((await (await request.get(`/api/orders/${walked.id}`)).json()).invoiceNo ?? null).toBeNull();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  ).toBeLessThanOrEqual(1);
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
  // the kiosk waits for the counter: the amount, and no order number yet
  const wait = kiosk.getByTestId('at-counter');
  await expect(wait).toContainText('Pay cash');
  await expect(kiosk.getByTestId('counter-amount')).toHaveText('₹93');
  await expect(kiosk.getByTestId('token')).toHaveCount(0);
  const id = (await wait.getAttribute('data-order'))!;
  const token = (await (await kiosk.request.get(`/api/orders/${id}`)).json()).token as string;
  await expect(wait).not.toContainText(`Order ${token}`);

  const kitchen = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await staff(kitchen);
  await kitchen.goto('/kitchen');
  await expect(kitchen.getByTestId(`due-${token}`)).toBeVisible({ timeout: 5000 });
  await expect(kitchen.getByTestId(`chit-${token}`)).toHaveCount(0);
  await kitchen.getByTestId(`due-${token}`).getByRole('button', { name: 'Paid' }).click();
  await expect(kitchen.getByTestId(`chit-${token}`)).toBeVisible({ timeout: 5000 });
  // only now does the customer get their number, on a ticket that says it is paid
  await expect(kiosk.getByTestId('token').locator('.num')).toHaveText(token, { timeout: 5000 });
  await expect(kiosk.getByTestId('token')).toContainText('Paid ₹93');
  await expect(kiosk.locator('.paid.due')).toHaveCount(0);
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

test('card at the counter: staff say not paid and the customer picks again; cancelling or walking off drops the order', async ({
  page,
  request,
}) => {
  await page.clock.install();
  await page.setViewportSize({ width: 800, height: 1280 });
  const toPay = async () => {
    await page.goto('/kiosk');
    await page.getByTestId('start').click();
    await page.getByTestId('item-masala-tea').click();
    await page.getByTestId('add-to-order').click();
    await page.getByTestId('cartbar').click();
    await page.getByTestId('takeaway').click();
    await page.getByTestId('continue-to-pay').click();
  };
  const waiting = async () => {
    const wait = page.getByTestId('at-counter');
    await expect(wait).toContainText('Pay by card');
    return (await wait.getAttribute('data-order'))!;
  };
  const statusOf = async (id: string) => (await (await request.get(`/api/orders/${id}`)).json()).status;

  // staff tap Cancel (not paid): back to the ways to pay, cart intact
  await toPay();
  await page.getByTestId('pay-card').click();
  const first = await waiting();
  expect(await statusOf(first)).toBe('awaiting_cash');
  await request.post(`/api/orders/${first}/status`, { data: { to: 'cancelled' }, headers: H });
  await page.clock.runFor(2000);
  await expect(page.getByTestId('pay-upi')).toBeVisible();
  // a second try is a new order, and "Other ways to pay" withdraws it
  await page.getByTestId('pay-card').click();
  const second = await waiting();
  expect(second).not.toBe(first);
  await page.getByTestId('counter-other').click();
  await expect(page.getByTestId('pay-upi')).toBeVisible();
  await expect.poll(() => statusOf(second)).toBe('cancelled');
  // the customer cancels: start screen, order dropped
  await page.getByTestId('pay-card').click();
  const third = await waiting();
  await page.getByTestId('counter-cancel').click();
  await expect(page.getByTestId('start')).toBeVisible();
  await expect.poll(() => statusOf(third)).toBe('cancelled');

  // nobody confirms and nobody is there: it asks, then clears and drops the order
  await toPay();
  await page.getByTestId('pay-card').click();
  const fourth = await waiting();
  await page.clock.runFor(175_000);
  await expect(page.getByTestId('still-there')).toHaveCount(0);
  await page.clock.runFor(10_000);
  await expect(page.getByTestId('still-there')).toContainText('I’m still paying'.replace('’', "'"));
  await page.getByRole('button', { name: "I'm still paying" }).click();
  await expect(page.getByTestId('at-counter')).toBeVisible();
  expect(await statusOf(fourth)).toBe('awaiting_cash');
  await page.clock.runFor(185_000);
  await expect(page.getByTestId('still-there')).toBeVisible();
  await page.clock.runFor(61_000);
  await expect(page.getByTestId('start')).toBeVisible();
  await expect.poll(() => statusOf(fourth)).toBe('cancelled');

  // a late cancel from the kiosk never undoes a payment staff confirmed
  await toPay();
  await page.getByTestId('pay-card').click();
  const fifth = await waiting();
  await request.post(`/api/orders/${fifth}/status`, { data: { to: 'new' }, headers: H });
  expect((await request.post(`/api/orders/${fifth}/claim`, { data: { action: 'cancel' } })).ok()).toBe(true);
  expect(await statusOf(fifth)).toBe('new');
  await page.clock.runFor(2000);
  await expect(page.getByTestId('token')).toContainText('Paid ₹');
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
  await counterPaid(page);
  await expect(page.getByTestId('token')).toBeVisible();
  await expect(page.getByTestId('thanks')).toContainText('Your Udupi Medu Vada is being made fresh.'); // matches what was ordered
  await page.clock.runFor(85_000);
  await expect(page.getByTestId('done-ask')).toHaveCount(0); // time to read the number and scan the bill
  await page.clock.runFor(7_000);
  await expect(page.getByTestId('done-ask')).toContainText('Still there?');
  await expect(page.getByTestId('done-ask')).toContainText(/Your order number is \d+\./); // repeated: the box covers the ticket
  await page.getByTestId('more-time').click();
  await page.clock.runFor(55_000);
  await expect(page.getByTestId('done-ask')).toHaveCount(0); // a minute more
  await page.clock.runFor(37_000);
  await expect(page.getByTestId('start')).toBeVisible(); // nobody answered: ready for the next customer
});

test('only choices that make sense: no fried-food notes on idli, no tag for a default', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.goto('/kiosk');
  await page.getByTestId('start').click();
  await page.getByTestId('item-mallige-idli').click();
  await expect(page.getByTestId('sheet')).toContainText('Make it extra');
  // no cooking requests any more: no "Note for the kitchen", no "Less oil" or "Extra crisp" on any dish
  for (const gone of ['Note for the kitchen', 'Less oil', 'Extra crisp', 'Potato stuffing'])
    await expect(page.getByTestId('sheet')).not.toContainText(gone);
  await page.getByTestId('sheet').getByRole('button', { name: 'Close' }).click();
  await page.getByTestId('item-medu-vada').click();
  for (const gone of ['Note for the kitchen', 'Less oil', 'Extra crisp'])
    await expect(page.getByTestId('sheet')).not.toContainText(gone);
  await page.getByTestId('sheet').getByRole('button', { name: 'Close' }).click();
  // the one choice kept, on the one dish it fits: a tick box like the paid extras, with no price on it
  await page.getByTestId('item-masala-dosa').click();
  const side = page.getByTestId('note-potato-side');
  await expect(side).toHaveText('Potato stuffing on the side');
  await expect(side).not.toContainText('₹');
  const paid = (await page.getByTestId('addon-benne').boundingBox())!;
  const free = (await side.boundingBox())!;
  expect(Math.round(free.height)).toBe(Math.round(paid.height)); // the same row as an extra
  expect(Math.round(free.width)).toBe(Math.round(paid.width));
  await side.click();
  await expect(side).toHaveClass(/on/);
  await expect(page.getByTestId('add-to-order')).toContainText('₹209'); // ticking it costs nothing
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

test('installable: each screen installs as its own app; the plain address shows nothing to a stranger', async ({
  page,
  request,
}) => {
  for (const [path, file] of [
    ['/kiosk', '/kiosk.webmanifest'],
    ['/kitchen', '/kitchen.webmanifest'],
    ['/board', '/board.webmanifest'],
    ['/admin', '/admin.webmanifest'],
  ]) {
    const m = await (await request.get(file)).json();
    expect(m.start_url, file).toBe(path); // the installed app opens this screen and stays on it
    expect(m.scope, file).toBe(path);
    const pngs = m.icons.filter((i: { type: string }) => i.type === 'image/png');
    expect(pngs.length).toBeGreaterThanOrEqual(3);
    for (const i of pngs) expect((await request.get(i.src)).status(), i.src).toBe(200);
    expect(await (await request.get(path)).text(), path).toContain(`href="${file}"`);
  }
  expect((await request.get('/icon.png')).status()).toBe(200); // the browser-tab icon

  // no list of the shop's screens at the plain address
  await page.goto('/');
  await expect(page.getByTestId('nothing-here')).toBeVisible();
  await expect(page.locator('a')).toHaveCount(0);
  // a device that has shown a screen before goes straight back to it
  await page.goto('/board');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('benne14.screen'))).toBe('board');
  await page.goto('/');
  await page.waitForURL('**/board');
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
  await expect(page.getByTestId('start-over')).toBeVisible(); // back by the owner's wish (2026-11-27), next to the timers
  await page.getByTestId('cartbar').click();
  await expect(page.getByTestId('cart-line')).toHaveCount(2);
  await expect(page.locator('.k-cart .rows')).toContainText('GST 5%');
  await expect(page.locator('.k-cart .rows')).not.toContainText('CGST');
});

test('an abandoned order is cleared: "Still there?" after two quiet minutes, the start screen 15 s later', async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.clock.install();
  await page.goto('/kiosk');
  await page.getByTestId('start').click();
  await page.getByTestId('item-medu-vada').click();
  await page.getByTestId('add-to-order').click();
  // reading the menu is not walking away: scrolling it (no tap at all) keeps the kiosk awake
  for (let i = 0; i < 3; i++) {
    await page.clock.runFor(100_000);
    await page.getByTestId('menu-list').evaluate((m, n) => {
      m.style.scrollBehavior = 'auto';
      m.scrollTop = 80 * (n + 1);
    }, i);
    // the browser reports a scroll on its next frame, in real time: let it land before the test's
    // clock is run forward again, or the scroll would be counted as happening after the wait
    await page.waitForTimeout(250);
    await expect(page.locator('.k-idle')).toHaveCount(0);
  }
  await page.clock.runFor(115_000);
  await expect(page.locator('.k-idle')).toHaveCount(0);
  await page.clock.runFor(7_000);
  await expect(page.locator('.k-idle')).toContainText('Still there?');
  await page.getByRole('button', { name: /Yes, I.m here/ }).click();
  await expect(page.getByTestId('cartbar')).toBeVisible(); // the order is kept
  await page.clock.runFor(122_000);
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

test('menu: a tapped section lights up, and the menu is where you left it after the cart', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.goto('/kiosk');
  await page.getByTestId('start').click();
  const on = page.locator('.k-menu .cat.on');
  for (const name of ['Coffee & Tea', 'Idli & Vada', 'Coffee & Tea', 'Dosas']) {
    await page.locator('.k-menu .cat', { hasText: name }).click();
    await expect(on).toHaveText(name);
    await page.waitForTimeout(900); // still lit once the list has stopped moving
    await expect(on).toHaveText(name);
  }
  await page.locator('.k-menu .cat', { hasText: 'Coffee & Tea' }).click();
  await page.waitForTimeout(900); // let the list arrive, as a customer would, before tapping a dish in it
  await page.getByTestId('item-masala-tea').click();
  await page.getByTestId('add-to-order').click();
  await page.getByTestId('cartbar').click();
  await page.locator('.k-cart .back').click();
  await expect(page.getByTestId('item-masala-tea')).toBeInViewport(); // not back at the top
  await expect(on).toHaveText('Coffee & Tea');
});

test('kiosk reads at arm’s length: no text under 16 px on any screen', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.goto('/kiosk');
  // text smaller than 16 px on the screen showing, apart from the logo's own tagline
  const small = () =>
    page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.kiosk *')]
        .filter((e) => e.offsetParent && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()))
        .filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16)
        .filter((e) => !e.closest('.logo, .brand'))
        .map((e) => e.textContent!.trim().slice(0, 30)),
    );
  expect(await small()).toEqual([]);
  await page.getByTestId('start').click();
  expect(await small()).toEqual([]);
  await page.getByTestId('item-masala-dosa').click();
  expect(await small()).toEqual([]);
  await page.getByTestId('add-to-order').click();
  await page.getByTestId('cartbar').click();
  expect(await small()).toEqual([]);
  await page.getByTestId('takeaway').click();
  await page.getByTestId('continue-to-pay').click();
  expect(await small()).toEqual([]);
  await page.getByTestId('pay-upi').click();
  await expect(page.locator('.k-upi')).toContainText('The amount is filled in.');
  await expect(page.locator('.k-upi .steps')).toHaveCount(0); // one instruction, not three ways of saying it
  expect(await small()).toEqual([]);
  await page.getByTestId('i-paid').click();
  await expect(page.getByTestId('token')).toBeVisible();
  expect(await small()).toEqual([]);
});

test('the cart suggests what the order is missing, not the same three dishes', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.goto('/kiosk');
  await expect(page.getByTestId('start')).toHaveText('Tap to order'); // no sub-line, no arrow glyph
  await page.getByTestId('start').click();
  await page.getByTestId('item-masala-dosa').click();
  await page.getByTestId('add-to-order').click();
  await page.getByTestId('cartbar').click();
  const offered = () =>
    page
      .locator('[data-testid^="suggest-"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.replace('suggest-', '')));
  const forDosa = await offered();
  expect(forDosa).toHaveLength(3);
  expect(forDosa).not.toContain('masala-dosa');
  expect(forDosa.some((id) => ['filter-coffee', 'masala-tea'].includes(id))).toBe(true); // no drink yet: offer one
  // taking a suggestion removes it and brings the next one
  await page.getByTestId(`suggest-${forDosa[0]}`).click();
  await expect(page.getByTestId('cart-line')).toHaveCount(2);
  expect(await offered()).not.toContain(forDosa[0]);
  await expect(page.locator('.k-cart .foot')).not.toContainText('UPI · Card');
  await expect(page.locator('.k-cart')).not.toContainText('→');

  // a drink-only order is offered food instead
  await page.goto('/kiosk');
  await page.getByTestId('start').click();
  await page.getByTestId('item-masala-tea').click();
  await page.getByTestId('add-to-order').click();
  await page.getByTestId('cartbar').click();
  const forTea = await offered();
  expect(forTea).not.toEqual(forDosa);
  expect(forTea).not.toContain('masala-tea');
  expect(forTea.some((id) => id.includes('dosa'))).toBe(true);
});

test('kitchen: a long order opens in full on a tap, and the screen uses the whole width of a wide monitor', async ({
  page,
  request,
}) => {
  const o = await (
    await request.post('/api/orders', {
      data: {
        key: `long-order-${Date.now()}`,
        type: 'dine_in',
        name: 'Big Table',
        payMethod: 'cash',
        lines: [
          { itemId: 'masala-dosa', qty: 3, choices: { dosaExtras: ['benne'] }, notes: ['potato-side'] },
          { itemId: 'plain-benne-dosa', qty: 2, choices: {}, notes: [] },
          { itemId: 'ghee-podi-thatte-idli', qty: 2, choices: {}, notes: [] },
          { itemId: 'medu-vada', qty: 4, choices: {}, notes: [] },
          { itemId: 'filter-coffee', qty: 5, choices: {}, notes: [] },
          { itemId: 'masala-tea', qty: 2, choices: {}, notes: [] },
        ],
      },
    })
  ).json();
  await staff(page);
  await page.setViewportSize({ width: 1920, height: 1080 }); // a 16:9 monitor: wider than the 16:10 design
  await page.goto('/kitchen');
  const width = async () => Math.round((await page.locator('.kitchen').boundingBox())!.width);
  await expect.poll(width).toBeGreaterThan(1915); // no empty bars left and right
  expect((await page.locator('.kitchen').boundingBox())!.x).toBeLessThan(2);
  await page.getByTestId('open-history').click();
  const row = page.getByTestId(`hist-${o.token}`);
  await expect(row.locator('.l2')).toBeVisible(); // collapsed: one cut-off line
  await expect(row).toContainText('18 items');
  await row.click();
  const full = page.getByTestId(`hist-full-${o.token}`);
  await expect(full.locator('li')).toHaveCount(6); // every dish on its own line
  await expect(full).toContainText('Masala Tea');
  await expect(full).toContainText('Extra benne · Potato stuffing on the side');
  await row.click();
  await expect(full).toHaveCount(0); // and closes again
  // on the 16:10 tablet nothing changes: the design is exactly the screen
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect.poll(width).toBe(1280);
});

test('kitchen: a long order goes out in parts, ticked line by line, and the ticks survive a reload', async ({
  page,
  request,
}) => {
  const o = await (
    await request.post('/api/orders', {
      data: {
        key: `ticks-${Date.now()}`,
        type: 'dine_in',
        name: 'Parts',
        payMethod: 'cash',
        lines: [
          { itemId: 'medu-vada', qty: 3, choices: {}, notes: [] },
          { itemId: 'filter-coffee', qty: 1, choices: {}, notes: [] },
        ],
      },
    })
  ).json();
  await request.post(`/api/orders/${o.id}/status`, { data: { to: 'new' }, headers: { 'x-staff-pin': PIN } });
  await staff(page);
  await page.goto('/kitchen');
  const chit = page.getByTestId(`chit-${o.token}`);
  const vada = page.getByTestId(`ln-${o.token}-0`);
  const coffee = page.getByTestId(`ln-${o.token}-1`);
  const go = page.getByTestId(`go-${o.token}`);
  await expect(chit).toHaveClass(/new/);

  await coffee.click(); // the coffee went out first
  await expect(coffee).toHaveClass(/given/);
  await expect(chit).toHaveClass(/cooking/); // giving something starts the order
  await vada.click();
  await vada.click();
  await expect(page.getByTestId(`gv-${o.token}-0`)).toHaveText('2 of 3 given');
  await expect(go).not.toHaveClass(/all/);

  await page.reload(); // another tablet, or this one after a restart, shows the same ticks
  await expect(page.getByTestId(`gv-${o.token}-0`)).toHaveText('2 of 3 given');
  await expect(coffee).toHaveClass(/given/);

  // a hold takes one back
  await vada.dispatchEvent('pointerdown', { clientX: 10, clientY: 10 });
  await expect(page.getByTestId(`gv-${o.token}-0`)).toHaveText('1 of 3 given');
  await vada.dispatchEvent('pointerup');

  await vada.click();
  await vada.click();
  await expect(vada).toHaveClass(/given/);
  await expect(go).toHaveClass(/all/); // everything is out: Ready is lit, the cook still taps it
  await expect(go).toHaveText('Ready');
  await vada.click(); // one tap too many does nothing but say how to undo
  await expect(page.locator('.kitchen')).toContainText('Hold the line');
  const saved = await (await request.get(`/api/orders/${o.id}`)).json();
  expect(saved.given).toEqual([3, 1]);
  expect(saved.status).toBe('cooking');
  await go.click();
  await expect(page.getByTestId(`ready-${o.token}`)).toBeVisible();
});

test('menu: scrolling down lights every section in turn, the short ones at the end included', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.goto('/kiosk');
  await page.getByTestId('start').click();
  const all = await page.locator('.k-menu .cat').allTextContents();
  expect(all.length).toBeGreaterThan(2);
  const seen: string[] = [];
  for (let i = 0; i < 400; i++) {
    const lit = (await page.locator('.k-menu .cat.on').textContent()) ?? '';
    if (seen[seen.length - 1] !== lit) seen.push(lit);
    const atEnd = await page
      .getByTestId('menu-list')
      .evaluate((m) => m.scrollTop >= m.scrollHeight - m.clientHeight - 1);
    if (atEnd) break;
    await page.getByTestId('menu-list').evaluate((m) => {
      m.style.scrollBehavior = 'auto';
      m.scrollTop += 40;
    });
    await page.waitForTimeout(20);
  }
  expect(seen).toEqual(all);
});

test('dish photos are shown whole: the dish sheet, the house special and the coffee suggestion', async ({ page }) => {
  // every dish gets the same 3:2 picture, the shape the shop's photos are shot in
  const shot = 'https://photos.test/dish-photos/dish.svg';
  const menu = await (await page.request.get('/api/menu')).json();
  const ids = ['ghee-podi-benne-dosa', 'masala-dosa', 'filter-coffee'];
  await page.route('**/api/menu', (r) =>
    r.fulfill({
      json: { ...menu, extras: { ...menu.extras, photos: Object.fromEntries(ids.map((i) => [i, shot])) } },
    }),
  );
  await page.route(shot, (r) =>
    r.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="667"><rect width="1000" height="667" fill="#2a6"/></svg>',
    }),
  );
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.goto('/kiosk');
  await page.getByTestId('start').click();
  const shape = async (sel: string) => {
    const b = (await page.locator(sel).boundingBox())!;
    return b.width / b.height;
  };
  await expect(page.locator('.k-menu .hero img')).toBeVisible();
  expect(await shape('.k-menu .hero img')).toBeCloseTo(1.5, 1); // not a cropped band
  await page.getByTestId('item-masala-dosa').click();
  await expect(page.locator('.k-sheet .ph img')).toBeVisible();
  expect(await shape('.k-sheet .ph img')).toBeCloseTo(1.5, 1);
  // the small suggestion picture fills its square instead of showing a corner of the full-size photo
  const small = (await page.locator('.k-sheet .pair .pimg img').boundingBox())!;
  const box = (await page.locator('.k-sheet .pair .pimg').boundingBox())!;
  expect(Math.round(small.width)).toBe(Math.round(box.width));
  expect(Math.round(small.height)).toBe(Math.round(box.height));
});

test('start screen: the shop’s logo, the host saying hello, and the photo wall still moving', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.goto('/kiosk');
  await expect(page.getByTestId('start')).toBeVisible();
  // the logo is the supplied picture, loaded, not text set in a font
  const logo = page.locator('.k-home .logo img');
  await expect(logo).toBeVisible();
  await expect.poll(() => logo.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
  await expect(page.getByTestId('hosts')).toContainText('Namaste!');
  await expect(page.getByTestId('hosts')).toContainText('Welcome to benne 14'); // the name as the shop writes it
  // the logo's block has square corners: the photos drifting behind it meet a straight edge
  expect(await page.locator('.k-home .logo').evaluate((e) => getComputedStyle(e).borderBottomRightRadius)).toBe('0px');
  // nothing new sits on top of what was there: the headline, the hosts and the button do not overlap
  const box = async (sel: string) => (await page.locator(sel).boundingBox())!;
  const [h1, hosts, start] = [await box('.k-home .copy h1'), await box('.k-home .hosts'), await box('.k-home .start')];
  // the headline's own words end before the host begins ("Fresh off" is its longer line)
  const words = await page.locator('.k-home .copy h1').evaluate((h) => {
    const walk = document.createTreeWalker(h, NodeFilter.SHOW_TEXT);
    let right = 0;
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const r = document.createRange();
      r.selectNodeContents(n);
      for (const c of r.getClientRects()) right = Math.max(right, c.right);
    }
    return right;
  });
  expect(hosts.x).toBeGreaterThanOrEqual(words);
  expect(h1.y).toBeGreaterThan(0);
  expect(hosts.y + hosts.height).toBeLessThanOrEqual(start.y);
  expect(hosts.x + hosts.width).toBeLessThanOrEqual(800);
  // the motion the owner approved is all still running: three drifting photo columns and the arrow's nudge
  const anims = await page.evaluate(() => ({
    cols: [...document.querySelectorAll('.k-home .col')].map((c) => getComputedStyle(c).animationName),
    arrow: getComputedStyle(document.querySelector('.k-home .start .arr')!).animationName,
  }));
  expect(anims.cols).toEqual(['drift', 'drift', 'drift']);
  expect(anims.arrow).toBe('nudge');
  // and the columns really move
  const y0 = (await box('.k-home .col:nth-child(2)')).y;
  await page.waitForTimeout(1500);
  expect((await box('.k-home .col:nth-child(2)')).y).not.toBe(y0);
  // tapping anywhere, a host included, still starts an order
  await page.getByTestId('hosts').click({ force: true });
  await expect(page.locator('.k-menu')).toBeVisible();
});

test('Start over: asks before clearing an order, clears at once when nothing is chosen', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.goto('/kiosk');
  await page.getByTestId('start').click();
  // the shop's logo heads the side bar
  const logo = page.locator('.k-menu .brand img');
  await expect(logo).toBeVisible();
  await expect.poll(() => logo.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
  // nothing chosen yet: straight back to the start screen, no question
  await page.getByTestId('start-over').click();
  await expect(page.getByTestId('start-over-ask')).toHaveCount(0);
  await expect(page.getByTestId('start')).toBeVisible();

  await page.getByTestId('start').click();
  await page.getByTestId('item-masala-tea').click();
  await page.getByTestId('add-to-order').click();
  // with a dish chosen it asks, and "Keep my order" changes nothing
  await page.getByTestId('start-over').click();
  await expect(page.getByTestId('start-over-ask')).toContainText('Start over?');
  await page.getByTestId('start-over-no').click();
  await expect(page.getByTestId('start-over-ask')).toHaveCount(0);
  await expect(page.getByTestId('cartbar')).toBeVisible();

  // from the cart, with a name typed and takeaway picked: everything goes
  await page.getByTestId('cartbar').click();
  await page.getByTestId('takeaway').click();
  await page.getByTestId('name-input').fill('Asha');
  await page.getByTestId('start-over').click();
  await page.getByTestId('start-over-yes').click();
  await expect(page.getByTestId('start')).toBeVisible();
  await page.getByTestId('start').click();
  await expect(page.getByTestId('cartbar')).toHaveCount(0); // no dishes left
  await page.getByTestId('item-masala-tea').click();
  await page.getByTestId('add-to-order').click();
  await page.getByTestId('cartbar').click();
  await expect(page.getByTestId('name-input')).toHaveValue(''); // nor the name
  await expect(page.getByTestId('takeaway')).not.toHaveClass(/on/); // nor dine in / takeaway
});

test('the order-number screen promises no time, says what was paid, and explains the QR plainly', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.goto('/kiosk');
  await page.getByTestId('start').click();
  await page.getByTestId('item-masala-tea').click();
  await page.getByTestId('add-to-order').click();
  await page.getByTestId('cartbar').click();
  await page.getByTestId('takeaway').click();
  await page.getByTestId('continue-to-pay').click();
  await page.getByTestId('pay-upi').click();
  await page.getByTestId('simulate-paid').click();
  const ticket = page.getByTestId('token');
  await expect(ticket).toBeVisible();
  await expect(ticket).toContainText('Paid ₹51 · UPI');
  const screen = page.locator('.k-done');
  for (const gone of [/Ready in/, /\bmin\b/, /Track/]) await expect(screen).not.toContainText(gone);
  await expect(screen).toContainText('Get your bill on your phone');
  await expect(screen).toContainText('Scan this code with your phone camera');
});

test('the house special is on the menu twice, at the top and in its section, and both are one dish', async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.goto('/kiosk');
  await page.getByTestId('start').click();
  const top = page.getByTestId('hero');
  const row = page.getByTestId('item-ghee-podi-benne-dosa');
  await expect(top).toBeVisible();
  await expect(row).toBeVisible(); // also a row among the dosas, like any other dish
  await expect(row.locator('.chip')).toHaveText('House special'); // tagged like the one at the top: plainly the same dish
  await expect(page.locator('.k-menu .list .item .chip')).toHaveCount(1); // and only that row
  await expect(page.locator('.k-menu .list .item').first()).toHaveAttribute('data-testid', 'item-ghee-podi-benne-dosa');
  // added from the top: the row shows it too
  await top.click();
  await page.getByTestId('add-to-order').click();
  await expect(top.locator('.step span')).toHaveText('1');
  await expect(row.locator('.step span')).toHaveText('1');
  // one more from the row: the top follows, and the order holds one line of two, not two lines
  await row.getByRole('button', { name: 'more' }).click();
  await expect(top.locator('.step span')).toHaveText('2');
  await expect(page.getByTestId('cartbar')).toContainText('2');
  await page.getByTestId('cartbar').click();
  await expect(page.getByTestId('cart-line')).toHaveCount(1);
  await expect(page.getByTestId('cart-total')).toHaveText('₹418'); // 2 × 199 + GST
});
