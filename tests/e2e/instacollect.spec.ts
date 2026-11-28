import { expect, test, type APIRequestContext } from '@playwright/test';
import { counterPaid } from '../support/kiosk';

// UPI through Easebuzz InstaCollect: a QR that pays into the shop's own virtual UPI ID. Own server
// (port 3108, PAYMENTS=instacollect) pointed at the stand-in Easebuzz (tests/support/fake-easebuzz.mjs),
// which checks our signatures and answers the way the documentation says the real one does. No real
// gateway is called and no money moves.
const FAKE = 'http://localhost:3199';
const BASE = 'http://localhost:3108';
const PIN = '2468';
const H = { 'x-staff-pin': PIN };

test.beforeAll(async ({ request }) => {
  const h = await (await request.get('/api/health')).json();
  if (h.store !== 'memory') throw new Error(`Refusing to run e2e against the ${h.store} store`);
  if (h.payments !== 'instacollect') throw new Error(`This suite needs PAYMENTS=instacollect, got ${h.payments}`);
});
test.describe.configure({ mode: 'serial' });

let k = 0;
const place = async (r: APIRequestContext, payMethod = 'upi') =>
  (
    await r.post('/api/orders', {
      data: {
        key: `ic-${Date.now()}-${k++}`,
        type: 'dine_in',
        name: 'Asha',
        payMethod,
        lines: [{ itemId: 'masala-dosa', qty: 1, choices: {}, notes: [] }],
      },
    })
  ).json();
const urn = (id: string) => id.replace(/-/g, '');
const gateway = async (r: APIRequestContext, id: string, action: 'start' | 'check') =>
  (await r.post(`/api/orders/${id}/gateway`, { data: { action } })).json();
const pays = (r: APIRequestContext, id: string, amount?: number) =>
  r.post(`${FAKE}/__ic/pay`, { data: { urn: urn(id), amount } });
const webhook = async (r: APIRequestContext, id: string, extra: object = {}) =>
  (
    await r.post(`${FAKE}/__ic/webhook`, {
      data: { urn: urn(id), url: `${BASE}/api/payments/instacollect/webhook`, ...extra },
    })
  ).json();
const order = async (r: APIRequestContext, id: string) => (await r.get(`/api/orders/${id}`)).json();
const theirs = async (r: APIRequestContext, id: string) =>
  (await (await r.get(`${FAKE}/__ic/orders`)).json()).find((o: { urn: string }) => o.urn === urn(id));
const paymentEvents = async (r: APIRequestContext, token: string) =>
  (await (await r.get('/api/admin/events', { headers: H })).json()).filter(
    (e: { kind: string; subject: string }) => e.kind === 'payment' && e.subject === `Order ${token}`,
  );

test('kiosk: a QR for exactly this bill; the customer pays and the order number comes up by itself', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.goto('/kiosk');
  await page.getByTestId('start').click();
  await page.getByTestId('item-masala-dosa').click();
  await page.getByTestId('add-to-order').click();
  await page.getByTestId('cartbar').click();
  await page.getByTestId('dine-in').click();
  await page.getByTestId('continue-to-pay').click();
  await page.getByTestId('pay-upi').click();
  // our own QR, drawn from the UPI ID Easebuzz gave this order; nothing to tap after paying
  await expect(page.getByTestId('gateway-qr').locator('svg')).toBeVisible();
  await expect(page.getByTestId('gateway-page')).toHaveCount(0);
  await expect(page.getByTestId('pay-waiting')).toBeVisible();
  await expect(page.getByTestId('i-paid')).toHaveCount(0);

  const o = (await (await request.get('/api/orders?view=today')).json())[0];
  expect(o.status).toBe('pending_payment');
  // what Easebuzz was asked for: this order, this amount, UPI only, a time limit, the shop's phone
  const made = await theirs(request, o.id);
  expect(made).toMatchObject({ amount: 219, status: 'created', modes: ['upi'], customer_phone: '7428671414' });
  expect(made.expiry_date).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);

  await pays(request, o.id); // scans and pays in their UPI app
  await expect(page.getByTestId('token')).toBeVisible({ timeout: 15_000 }); // found by our own check, no webhook needed
  const paid = await order(request, o.id);
  expect(paid).toMatchObject({ status: 'new', payGateway: 'instacollect' });
  expect(paid.payRef).toMatch(/^cvatfake/);
  expect(paid.invoiceNo).toMatch(/^B14\//);
  const log = await (await request.get(`/api/admin/orders/${o.id}/events`, { headers: H })).json();
  expect(log[1].note).toContain(`Instacollect ${paid.payRef}`);
  expect(log[1].note).toContain('UPI ref 2313');
});

test('a reloaded kiosk gets the same QR again, not a second one', async ({ request }) => {
  const o = await place(request);
  const first = await gateway(request, o.id, 'start');
  expect(first.kind).toBe('qr');
  expect(await gateway(request, o.id, 'start')).toEqual(first);
  const all = (await (await request.get(`${FAKE}/__ic/orders`)).json()).filter(
    (x: { urn: string }) => x.urn === urn(o.id),
  );
  expect(all).toHaveLength(1);
  await request.post(`/api/orders/${o.id}/claim`, { data: { action: 'cancel' } });
});

test('the webhook alone confirms a payment; repeats are harmless', async ({ request }) => {
  const o = await place(request);
  await gateway(request, o.id, 'start');
  await pays(request, o.id);
  const hook = await webhook(request, o.id);
  expect(hook.status).toBe(200);
  expect(JSON.parse(hook.body)).toMatchObject({ ok: true, state: 'paid' });
  expect((await order(request, o.id)).status).toBe('new');
  expect((await webhook(request, o.id)).status).toBe(200); // Easebuzz sends it again: nothing changes
  const paid = await order(request, o.id);
  expect(paid.status).toBe('new');
  const log = await (await request.get(`/api/admin/orders/${o.id}/events`, { headers: H })).json();
  expect(log.filter((e: { kind: string }) => e.kind === 'status')).toHaveLength(1);
});

test('a forged or untrue "paid" message never marks an order paid', async ({ request }) => {
  const o = await place(request);
  await gateway(request, o.id, 'start');
  // a message with a bad signature
  expect((await webhook(request, o.id, { claim: 'completed', forge: true })).status).toBe(400);
  // a correctly signed message saying "completed" while Easebuzz itself has no payment for the order
  const lie = await webhook(request, o.id, { claim: 'completed' });
  expect(lie.status).toBe(200);
  expect(JSON.parse(lie.body).state).toBe('waiting');
  // someone posting straight to our address
  const direct = await request.post('/api/payments/instacollect/webhook', {
    data: {
      event: 'ORDER_STATUS_UPDATE',
      data: { merchant_request_number: urn(o.id), status: 'completed', amount: 219 },
    },
  });
  expect(direct.status()).toBe(400);
  expect((await order(request, o.id)).status).toBe('pending_payment');
  // bodies that are not what Easebuzz sends
  for (const body of ['', 'not json', '[]', '{"event":"ORDER_STATUS_UPDATE"}'])
    expect(
      (
        await request.post('/api/payments/instacollect/webhook', {
          data: body,
          headers: { 'Content-Type': 'application/json' },
        })
      ).status(),
    ).toBe(400);
  // events we do not act on are accepted, so Easebuzz does not keep resending them
  const other = await request.post('/api/payments/instacollect/webhook', {
    data: { event: 'TRANSACTION_CREDIT', data: {} },
  });
  expect(other.status()).toBe(200);
  await request.post(`/api/orders/${o.id}/claim`, { data: { action: 'cancel' } });
});

test('a part payment or a wrong amount is not accepted as payment, and the owner is told once', async ({ request }) => {
  const o = await place(request);
  await gateway(request, o.id, 'start');
  await pays(request, o.id, 100); // a UPI ID takes whatever it is sent
  expect((await gateway(request, o.id, 'check')).state).toBe('problem');
  await webhook(request, o.id);
  expect((await order(request, o.id)).status).toBe('pending_payment');
  const events = await paymentEvents(request, o.token);
  expect(events).toHaveLength(1);
  expect(events[0].note).toContain('₹100 via InstaCollect');
  expect(events[0].note).toContain('the order is ₹219');
});

test('cancelling at the kiosk closes the QR at Easebuzz, so a late scan cannot pay it', async ({ request }) => {
  const o = await place(request);
  await gateway(request, o.id, 'start');
  expect((await theirs(request, o.id)).status).toBe('created');
  expect((await request.post(`/api/orders/${o.id}/claim`, { data: { action: 'cancel' } })).status()).toBe(200);
  await expect.poll(async () => (await theirs(request, o.id)).status).toBe('cancelled');
  expect((await pays(request, o.id)).status()).toBe(409); // the bank turns the money away
  expect((await order(request, o.id)).status).toBe('cancelled');
});

test('staff cancelling an unpaid UPI order, or a changed checkout replacing one, closes its QR too', async ({
  request,
}) => {
  // staff cancel it from the kitchen screen
  const o = await place(request);
  await gateway(request, o.id, 'start');
  expect((await theirs(request, o.id)).status).toBe('created');
  const r = await request.post(`/api/orders/${o.id}/status`, { data: { to: 'cancelled' }, headers: H });
  expect(r.status()).toBe(200);
  await expect.poll(async () => (await theirs(request, o.id)).status).toBe('cancelled');
  expect((await pays(request, o.id)).status()).toBe(409);

  // the customer went back and changed the order: same checkout, different dishes
  const key = `ic-changed-${Date.now()}`;
  const body = (itemId: string) => ({
    key,
    type: 'takeaway',
    name: null,
    payMethod: 'upi',
    lines: [{ itemId, qty: 1, choices: {}, notes: [] }],
  });
  const first = await (await request.post('/api/orders', { data: body('masala-dosa') })).json();
  await gateway(request, first.id, 'start');
  expect((await theirs(request, first.id)).status).toBe('created');
  const second = await (await request.post('/api/orders', { data: body('masala-tea') })).json();
  expect(second.id).not.toBe(first.id);
  expect((await order(request, first.id)).status).toBe('cancelled');
  await expect.poll(async () => (await theirs(request, first.id)).status).toBe('cancelled');
});

test('the owner can check InstaCollect against Easebuzz from the technical page: keys, a ₹1 QR, cancel', async ({
  page,
  request,
}) => {
  expect(
    (await request.post('/api/admin/instacollect', { headers: { 'x-forwarded-for': '10.55.0.1' } })).status(),
  ).toBe(401);
  const before = (await (await request.get(`${FAKE}/__ic/orders`)).json()).length;
  const r = await (await request.post('/api/admin/instacollect', { headers: H })).json();
  expect(r.steps.map((s: { step: string; ok: boolean }) => [s.step, s.ok])).toEqual([
    ['Keys accepted', true],
    ['A ₹1 QR can be made', true],
    ['That QR can be cancelled', true],
  ]);
  // it left one ₹1 order at Easebuzz, cancelled, and none in the shop's own books
  const theirOrders = await (await request.get(`${FAKE}/__ic/orders`)).json();
  expect(theirOrders).toHaveLength(before + 1);
  expect(theirOrders.at(-1)).toMatchObject({ amount: 1, status: 'cancelled' });
  expect(JSON.stringify(r)).not.toContain('FAKESALT01');

  // from the owner app
  await page.addInitScript((pin) => localStorage.setItem('benne14.ownerPin', pin), PIN);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin');
  await page.getByTestId('sysline').click();
  await page.getByTestId('open-tech').click();
  await page.getByTestId('ic-check').click();
  await expect(page.getByTestId('ic-step')).toHaveCount(3, { timeout: 15_000 });
  await expect(page.getByTestId('ic-step').nth(1)).toContainText('Easebuzz gave a UPI ID to pay into');

  // Easebuzz not answering: the check says so and stops, instead of calling the keys good or bad
  await request.post(`${FAKE}/__ic/down`, { data: { on: true } });
  try {
    const down = await (await request.post('/api/admin/instacollect', { headers: H })).json();
    expect(down.steps).toHaveLength(1);
    expect(down.steps[0]).toMatchObject({ step: 'Keys accepted', ok: false });
    expect(down.steps[0].detail).toContain('503');
  } finally {
    await request.post(`${FAKE}/__ic/down`, { data: { on: false } });
  }
});

test('kiosk: if InstaCollect is down, UPI steps aside and the customer pays by card or cash', async ({
  page,
  request,
}) => {
  await request.post(`${FAKE}/__ic/down`, { data: { on: true } });
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
    await expect(page.getByTestId('pay-upi')).toBeDisabled({ timeout: 15_000 });
    await expect(page.getByTestId('pay-upi')).toContainText('Not working right now');
    await expect(page.getByTestId('gateway-qr')).toHaveCount(0);
    await page.getByTestId('pay-cash').click();
    await counterPaid(page);
    await expect(page.getByTestId('token')).toBeVisible();
  } finally {
    await request.post(`${FAKE}/__ic/down`, { data: { on: false } });
  }
});
