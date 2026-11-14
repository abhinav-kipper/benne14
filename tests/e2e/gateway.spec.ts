import { expect, test, type APIRequestContext } from '@playwright/test';

// UPI through the payment gateway (Easebuzz). Own server (port 3104, PAYMENTS=easebuzz) pointed at a
// stand-in Easebuzz (tests/support/fake-easebuzz.mjs) that signs and answers like the real one, so
// no real gateway is called and no money moves.
const FAKE = 'http://localhost:3199';
const PIN = '2468';
const H = { 'x-staff-pin': PIN };

test.beforeAll(async ({ request }) => {
  const h = await (await request.get('/api/health')).json();
  if (h.store !== 'memory') throw new Error(`Refusing to run e2e against the ${h.store} store`);
  if (h.payments !== 'easebuzz') throw new Error(`This suite needs PAYMENTS=easebuzz, got ${h.payments}`);
});
test.describe.configure({ mode: 'serial' });

let k = 0;
const place = async (r: APIRequestContext, payMethod = 'upi', itemId = 'masala-dosa') =>
  (
    await r.post('/api/orders', {
      data: {
        key: `gw-${Date.now()}-${k++}`,
        type: 'takeaway',
        name: 'Asha',
        payMethod,
        lines: [{ itemId, qty: 1, choices: {}, notes: [] }],
      },
    })
  ).json();
const txn = (id: string) => id.replace(/-/g, '');
const gateway = async (r: APIRequestContext, id: string, action: 'start' | 'check') =>
  (await r.post(`/api/orders/${id}/gateway`, { data: { action } })).json();
const customer = (r: APIRequestContext, id: string, status: string, amount?: string) =>
  r.post(`${FAKE}/__set`, { data: { txnid: txn(id), status, amount } });
const webhook = async (r: APIRequestContext, id: string, extra: object = {}, baseURL = 'http://localhost:3104') =>
  (
    await r.post(`${FAKE}/__webhook`, {
      data: { txnid: txn(id), url: `${baseURL}/api/payments/easebuzz/webhook`, ...extra },
    })
  ).json();
const order = async (r: APIRequestContext, id: string) => (await r.get(`/api/orders/${id}`)).json();
const paymentEvents = async (r: APIRequestContext, token: string) =>
  (await (await r.get('/api/admin/events', { headers: H })).json()).filter(
    (e: { kind: string; subject: string }) => e.kind === 'payment' && e.subject === `Order ${token}`,
  );

test('kiosk: the customer pays and the order number comes up by itself, no staff tap', async ({ page, request }) => {
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.goto('/kiosk');
  await page.getByTestId('start').click();
  await page.getByTestId('item-masala-dosa').click();
  await page.getByTestId('add-to-order').click();
  await page.getByTestId('cartbar').click();
  await page.getByTestId('takeaway').click();
  await page.getByTestId('continue-to-pay').click();
  await page.getByTestId('pay-upi').click();
  // the gateway's page is shown in a frame, with this order's amount; there is nothing to tap after paying
  await expect(page.getByTestId('gateway-page')).toBeVisible();
  await expect(page.frameLocator('.k-upi .gateway iframe').getByTestId('fake-amount')).toHaveText('Pay ₹ 219.0');
  await expect(page.getByTestId('pay-waiting')).toBeVisible();
  await expect(page.getByTestId('i-paid')).toHaveCount(0);

  const o = (await (await request.get('/api/orders?view=today')).json())[0];
  expect(o.status).toBe('pending_payment');
  await customer(request, o.id, 'success'); // scans and pays in their UPI app
  await expect(page.getByTestId('token')).toBeVisible({ timeout: 15_000 }); // found by our own check, no webhook needed
  await expect(page.getByTestId('thanks')).toBeVisible();

  const paid = await order(request, o.id);
  expect(paid).toMatchObject({ status: 'new', payGateway: 'easebuzz' });
  expect(paid.payRef).toMatch(/^E26FAKE/);
  expect(paid.paidAt).toBeTruthy();
  // the order's history says who confirmed it and with which reference
  const log = await (await request.get(`/api/admin/orders/${o.id}/events`, { headers: H })).json();
  expect(log.map((e: { kind: string }) => e.kind)).toEqual(['placed', 'status']);
  expect(log[1].note).toContain(`Easebuzz ${paid.payRef}`);
});

test('the webhook alone confirms a payment; repeats are harmless', async ({ request }) => {
  const o = await place(request);
  expect(await gateway(request, o.id, 'start')).toMatchObject({ kind: 'page' });
  await customer(request, o.id, 'success');
  expect(await webhook(request, o.id)).toMatchObject({ status: 200 });
  const paid = await order(request, o.id);
  expect(paid.status).toBe('new');
  // Easebuzz retries, and the kiosk also checks: nothing changes, nothing is recorded twice
  expect(await webhook(request, o.id)).toMatchObject({ status: 200 });
  expect((await gateway(request, o.id, 'check')).state).toBe('paid');
  const after = await order(request, o.id);
  expect(after.paidAt).toBe(paid.paidAt);
  expect(after.payRef).toBe(paid.payRef);
  const log = await (await request.get(`/api/admin/orders/${o.id}/events`, { headers: H })).json();
  expect(log.filter((e: { kind: string }) => e.kind === 'status')).toHaveLength(1);
});

test('a forged or untrue "paid" message never marks an order paid', async ({ request }) => {
  const o = await place(request);
  await gateway(request, o.id, 'start');
  // 1) wrong signature
  expect(await webhook(request, o.id, { claim: 'success', forge: true })).toMatchObject({ status: 400 });
  // 2) correctly signed "success", but Easebuzz's own records say it isn't paid (a replayed or leaked message)
  expect(await webhook(request, o.id, { claim: 'success' })).toMatchObject({ status: 200 });
  // 3) junk
  for (const body of ['', 'not a form', 'txnid=abc&status=success&hash=zz'])
    expect(
      (
        await request.post('/api/payments/easebuzz/webhook', {
          data: body,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        })
      ).status(),
      body,
    ).toBe(400);
  expect((await order(request, o.id)).status).toBe('pending_payment');
  expect((await gateway(request, o.id, 'check')).state).toBe('waiting');
  // a signed message about a payment that isn't one of our orders is acknowledged and ignored
  expect(
    (
      await (
        await request.post(`${FAKE}/__webhook`, {
          data: {
            txnid: 'LINK-FROM-DASHBOARD',
            url: 'http://localhost:3104/api/payments/easebuzz/webhook',
            claim: 'success',
          },
        })
      ).json()
    ).status,
  ).toBe(200);
});

test('money for the wrong amount is not accepted as payment, and the owner is told', async ({ request }) => {
  const o = await place(request);
  await gateway(request, o.id, 'start');
  await customer(request, o.id, 'success', '1.0'); // ₹1 paid for a ₹219 order
  expect((await gateway(request, o.id, 'check')).state).toBe('problem');
  await webhook(request, o.id);
  expect((await gateway(request, o.id, 'check')).state).toBe('problem');
  expect((await order(request, o.id)).status).toBe('pending_payment');
  const ev = await paymentEvents(request, o.token);
  expect(ev).toHaveLength(1); // recorded once, however often it is seen
  expect(ev[0].note).toContain('the order is ₹219');
});

test('paid after the order was cancelled: it stays cancelled and is flagged for a refund', async ({ request }) => {
  const o = await place(request);
  await gateway(request, o.id, 'start');
  await request.post(`/api/orders/${o.id}/claim`, { data: { action: 'cancel' } }); // QR timed out on the kiosk
  await customer(request, o.id, 'success'); // …but the customer still scanned it
  expect(await webhook(request, o.id)).toMatchObject({ status: 200 });
  expect((await order(request, o.id)).status).toBe('cancelled');
  await webhook(request, o.id);
  const ev = await paymentEvents(request, o.token);
  expect(ev).toHaveLength(1);
  expect(ev[0].note).toContain('paid after the order was cancelled');
});

test('kiosk: a failed payment says so, and another way to pay still works', async ({ page, request }) => {
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.goto('/kiosk');
  await page.getByTestId('start').click();
  await page.getByTestId('item-masala-tea').click();
  await page.getByTestId('add-to-order').click();
  await page.getByTestId('cartbar').click();
  await page.getByTestId('takeaway').click();
  await page.getByTestId('continue-to-pay').click();
  await page.getByTestId('pay-upi').click();
  await expect(page.getByTestId('gateway-page')).toBeVisible();
  const o = (await (await request.get('/api/orders?view=today')).json())[0];
  await customer(request, o.id, 'failure');
  await expect(page.getByTestId('pay-trouble')).toContainText('didn’t go through', { timeout: 10_000 });
  await page.locator('.k-upi .back').click(); // Other ways to pay
  await page.getByTestId('pay-cash').click();
  await expect(page.getByTestId('token')).toBeVisible();
  expect((await order(request, o.id)).status).toBe('cancelled'); // the UPI attempt is closed, not left open
});

test('kiosk: if the gateway is down, the shop’s own QR and "I’ve paid" take over', async ({ page, request }) => {
  await request.post(`${FAKE}/__down`, { data: { on: true } });
  try {
    await page.setViewportSize({ width: 800, height: 1280 });
    await page.goto('/kiosk');
    await page.getByTestId('start').click();
    await page.getByTestId('item-masala-tea').click();
    await page.getByTestId('add-to-order').click();
    await page.getByTestId('cartbar').click();
    await page.getByTestId('takeaway').click();
    await page.getByTestId('continue-to-pay').click();
    await page.getByTestId('pay-upi').click();
    await expect(page.getByTestId('i-paid')).toBeEnabled();
    await expect(page.getByTestId('gateway-page')).toHaveCount(0);
    await expect(page.locator('.k-upi .qrcard img')).toBeVisible();
    const o = (await (await request.get('/api/orders?view=today')).json())[0];
    expect((await gateway(request, o.id, 'check')).state).toBe('waiting'); // can't tell: never "failed" by mistake
    await page.getByTestId('i-paid').click();
    await expect(page.getByTestId('token')).toBeVisible();
    expect((await order(request, o.id)).status).toBe('awaiting_cash'); // staff confirm on the soundbox, as before
  } finally {
    await request.post(`${FAKE}/__down`, { data: { on: false } });
  }
});

test('gateway API: bad input, cash orders and unknown orders', async ({ request }) => {
  const NIL = '00000000-0000-0000-0000-000000000000';
  expect((await request.post(`/api/orders/${NIL}/gateway`, { data: { action: 'start' } })).status()).toBe(404);
  expect((await request.post('/api/orders/not-an-id/gateway', { data: { action: 'start' } })).status()).toBe(404);
  const cash = await place(request, 'cash');
  expect((await request.post(`/api/orders/${cash.id}/gateway`, { data: { action: 'pay' } })).status()).toBe(400);
  expect(await gateway(request, cash.id, 'start')).toEqual({ kind: 'direct' }); // nothing to pay online
  expect((await gateway(request, cash.id, 'check')).state).toBe('waiting');
  // asking twice for one order (a reloaded kiosk) shows the same payment, not a second one
  const upi = await place(request);
  const first = await gateway(request, upi.id, 'start');
  expect(first.kind).toBe('page');
  expect(await gateway(request, upi.id, 'start')).toEqual(first);
});

const toUpiScreen = async (page: import('@playwright/test').Page, itemId = 'masala-tea') => {
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.goto('/kiosk');
  await page.getByTestId('start').click();
  await page.getByTestId(`item-${itemId}`).click();
  await page.getByTestId('add-to-order').click();
  await page.getByTestId('cartbar').click();
  await page.getByTestId('takeaway').click();
  await page.getByTestId('continue-to-pay').click();
  await page.getByTestId('pay-upi').click();
  await expect(page.getByTestId('gateway-page')).toBeVisible();
};

test('kiosk waits for the payment with no countdown; a customer who walks off and pays later still gets the order', async ({
  page,
  request,
}) => {
  await page.clock.install();
  await toUpiScreen(page);
  await expect(page.locator('.k-upi .timer')).toBeHidden(); // no "QR valid for 5:00" pressure
  const o = (await (await request.get('/api/orders?view=today')).json())[0];
  await customer(request, o.id, 'pending'); // tapped "Pay by QR" and "Pay": the QR is on screen
  await page.clock.runFor(3 * 60_000 + 50_000); // just under four quiet minutes since the QR appeared
  await expect(page.getByTestId('still-there')).toHaveCount(0);
  await page.clock.runFor(20_000); // the kiosk learns the QR is up within one 3 s check, so allow for that
  // a long silence: ask, don't cancel
  await expect(page.getByTestId('still-there')).toContainText('If you have already paid, your order is safe');
  await page.getByRole('button', { name: /still paying/ }).click();
  await expect(page.getByTestId('still-there')).toHaveCount(0);
  await expect(page.getByTestId('gateway-page')).toBeVisible();
  // silence again, and this time nobody answers: the kiosk is freed for the next customer…
  await page.clock.runFor(4 * 60_000 + 5_000);
  await expect(page.getByTestId('still-there')).toBeVisible();
  await page.clock.runFor(31_000);
  await expect(page.getByTestId('start')).toBeVisible();
  // …but the order is not cancelled, because its QR could still be paid
  expect((await order(request, o.id)).status).toBe('pending_payment');
  await customer(request, o.id, 'success'); // the customer finishes in their UPI app after walking off
  // nobody at the kiosk and no webhook: the kitchen screen's own polling notices the payment
  await expect
    .poll(
      async () => {
        await request.get('/api/orders');
        return (await order(request, o.id)).status;
      },
      { timeout: 45_000, intervals: [1000, 2000, 5000] },
    )
    .toBe('new');
  expect((await order(request, o.id)).payRef).toMatch(/^E26FAKE/);
});

test('kiosk: walking off before any QR appeared cancels the order, since nothing could be paid', async ({
  page,
  request,
}) => {
  await page.clock.install();
  await toUpiScreen(page);
  const o = (await (await request.get('/api/orders?view=today')).json())[0];
  await page.clock.runFor(4 * 60_000 + 5_000);
  await expect(page.getByTestId('still-there')).toBeVisible();
  await page.clock.runFor(31_000);
  await expect(page.getByTestId('start')).toBeVisible();
  expect((await order(request, o.id)).status).toBe('cancelled');
});
