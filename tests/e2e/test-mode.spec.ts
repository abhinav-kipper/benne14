import { expect, test } from '@playwright/test';

// Test mode (pre-launch): cash counts as paid at once, and the ₹1 payment test item can be ordered.
test.beforeAll(async ({ request }) => {
  const h = await (await request.get('/api/health')).json();
  if (h.store !== 'memory') throw new Error(`Refusing to run e2e against the ${h.store} store`);
  expect(h.testMode).toContain('on');
});

const order = (lines: { itemId: string; qty: number }[], payMethod: string, key: string) => ({
  key,
  type: 'takeaway',
  name: 'Test',
  payMethod,
  lines: lines.map((l) => ({ ...l, choices: {}, notes: [] })),
});

test('cash goes straight to the kitchen in test mode', async ({ request }) => {
  const r = await request.post('/api/orders', {
    data: order([{ itemId: 'medu-vada', qty: 1 }], 'cash', 'tm-cash-0001'),
  });
  expect(r.status()).toBe(201);
  const o = await r.json();
  expect(o.status).toBe('new'); // not awaiting_cash
  const live = await (await request.get('/api/orders')).json();
  expect(live.find((x: { id: string }) => x.id === o.id)?.status).toBe('new');
});

test('the ₹1 payment test item can be ordered and costs ₹1', async ({ request }) => {
  const r = await request.post('/api/orders', { data: order([{ itemId: 'test-1', qty: 1 }], 'upi', 'tm-rupee-0001') });
  expect(r.status()).toBe(201);
  const o = await r.json();
  expect(o.total).toBe(1);
  expect(o.status).toBe('pending_payment'); // UPI stays real: waits for "I've paid" / the counter
});
