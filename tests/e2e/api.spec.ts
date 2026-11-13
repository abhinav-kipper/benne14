import { expect, test, type APIRequestContext } from '@playwright/test';

// The order API against bad, repeated and racing requests. Own server (memory store), so the
// orders made here never show up in the other suites.
const PIN = '2468';
const NIL = '00000000-0000-0000-0000-000000000000';

test.beforeAll(async ({ request }) => {
  const h = await (await request.get('/api/health')).json();
  if (h.store !== 'memory') throw new Error(`Refusing to run e2e against the ${h.store} store`);
});

let k = 0;
const key = () => `api-${Date.now()}-${k++}`;
const line = (itemId = 'masala-dosa', qty = 1) => ({ itemId, qty, choices: {}, notes: [] });
const place = (r: APIRequestContext, data: Record<string, unknown>) =>
  r.post('/api/orders', {
    data: { key: key(), type: 'takeaway', name: null, payMethod: 'cash', lines: [line()], ...data },
  });
const status = (r: APIRequestContext, id: string, data: unknown, pin = PIN, ip = '127.0.0.1') =>
  r.post(`/api/orders/${id}/status`, { data: data as object, headers: { 'x-staff-pin': pin, 'x-forwarded-for': ip } });

test('bad requests get a clear 400, never a server error', async ({ request }) => {
  const raw = (path: string, body: string, headers: Record<string, string> = {}) =>
    request.post(path, { data: body, headers: { 'Content-Type': 'application/json', ...headers } });
  for (const body of ['{bad', '', 'null', '[]', '"x"']) {
    expect((await raw('/api/orders', body)).status(), `order body ${body}`).toBe(400);
    expect((await raw(`/api/orders/${NIL}/claim`, body)).status(), `claim body ${body}`).toBe(400);
    expect((await raw(`/api/orders/${NIL}/status`, body, { 'x-staff-pin': PIN })).status(), `status body ${body}`).toBe(
      400,
    );
  }
  const bad: Record<string, unknown>[] = [
    { key: 'short' },
    { type: 'delivery' },
    { payMethod: 'bitcoin' },
    { lines: [] },
    { lines: 'x' },
    { lines: [null] },
    { lines: [line('pizza')] },
    { lines: [line('masala-dosa', 0)] },
    { lines: [line('masala-dosa', 21)] },
    { lines: [{ ...line(), notes: { a: 1 } }] },
    { lines: [{ ...line(), choices: { dosaExtras: 'benne' } }] },
    { lines: Array.from({ length: 41 }, () => line()) },
    { lines: [line('test-1')] }, // ₹1 item: test mode is off here
  ];
  for (const b of bad) {
    const r = await place(request, b);
    expect(r.status(), JSON.stringify(b).slice(0, 80)).toBe(400);
    expect((await r.json()).error).toBeTruthy();
  }
});

test('the server sets every price; whatever the client sends is ignored', async ({ request }) => {
  const r = await request.post('/api/orders', {
    data: {
      key: key(),
      type: 'takeaway',
      name: null,
      payMethod: 'cash',
      total: 1,
      subtotal: 1,
      lines: [
        {
          itemId: 'masala-dosa',
          qty: 1,
          choices: { dosaExtras: ['benne'] },
          notes: [],
          price: 1,
          unitPrice: 1,
          lineTotal: 1,
        },
      ],
    },
  });
  const o = await r.json();
  expect(o.lines[0].unitPrice).toBe(234); // 209 + 25 extra benne
  expect(o.total).toBe(246); // 234 + ₹12 GST
});

test('names are cleaned before they reach the TV', async ({ request }) => {
  const o = await (await place(request, { name: '  Ra\u0000hul‮   Kumar Sharma from Indirapuram' })).json();
  expect(o.customerName).toBe('Rahul Kumar Sharma from');
});

test('checkout is idempotent: retries and racing double-taps make one order', async ({ request }) => {
  const k1 = key();
  const body = { key: k1, type: 'takeaway', name: 'Asha', payMethod: 'cash', lines: [line()] };
  const results = await Promise.all(Array.from({ length: 8 }, () => request.post('/api/orders', { data: body })));
  const ids = new Set(await Promise.all(results.map(async (r) => (await r.json()).id)));
  expect(ids.size).toBe(1);
  const today = await (await request.get('/api/orders?view=today')).json();
  expect(today.filter((o: { customerName: string }) => o.customerName === 'Asha')).toHaveLength(1);
});

test('order numbers stay unique when many kiosks order at once', async ({ request }) => {
  const rs = await Promise.all(Array.from({ length: 25 }, () => place(request, {})));
  const tokens = await Promise.all(rs.map(async (r) => (await r.json()).token as string));
  expect(new Set(tokens).size).toBe(25);
});

test('staff actions need the PIN; unknown or malformed ids are 404', async ({ request }) => {
  const o = await (await place(request, {})).json();
  expect((await status(request, o.id, { to: 'new' }, '0000', '10.1.1.1')).status()).toBe(401);
  expect((await request.post(`/api/orders/${o.id}/status`, { data: { to: 'new' } })).status()).toBe(401);
  expect((await status(request, NIL, { to: 'new' })).status()).toBe(404);
  for (const id of ['abc', "1'or'1'='1", NIL + 'x']) {
    expect((await status(request, id, { to: 'new' })).status()).toBe(404);
    expect((await request.get(`/api/orders/${encodeURIComponent(id)}`)).status()).toBe(404);
    expect((await request.get(`/api/orders/${encodeURIComponent(id)}/upi`)).status()).toBe(404);
  }
  expect((await status(request, o.id, { to: 'pending_payment' })).status()).toBe(400); // staff can't "unpay"
  expect((await status(request, o.id, { to: 'cooking' })).status()).toBe(409); // must be paid first
});

test('wrong PINs lock that device out for a while (no guessing all 10,000)', async ({ request }) => {
  const ip = '203.0.113.7';
  const o = await (await place(request, {})).json();
  for (let i = 0; i < 30; i++)
    expect((await status(request, o.id, { to: 'new' }, String(1000 + i), ip)).status()).toBe(401);
  expect((await status(request, o.id, { to: 'new' }, PIN, ip)).status()).toBe(429);
  expect((await request.post('/api/staff', { headers: { 'x-staff-pin': PIN, 'x-forwarded-for': ip } })).status()).toBe(
    429,
  );
  expect((await status(request, o.id, { to: 'new' }, PIN, '203.0.113.8')).status()).toBe(200); // other devices unaffected
});

test('two kitchen tablets: a stale tap is refused instead of undoing the other one', async ({ request }) => {
  const o = await (await place(request, {})).json();
  for (const [from, to] of [
    ['awaiting_cash', 'new'],
    ['new', 'cooking'],
    ['cooking', 'ready'],
  ])
    expect((await status(request, o.id, { to, from })).status()).toBe(200);
  // Tablet B hasn't refreshed: it still shows "new" and taps Start
  const stale = await status(request, o.id, { to: 'cooking', from: 'new' });
  expect(stale.status()).toBe(409);
  expect((await stale.json()).error).toContain('another screen');
  expect((await (await request.get(`/api/orders/${o.id}`)).json()).status).toBe('ready');
  // Racing taps on the same move: both succeed or are no-ops, and the order ends where they meant
  const both = await Promise.all([
    status(request, o.id, { to: 'handed_over', from: 'ready' }),
    status(request, o.id, { to: 'handed_over', from: 'ready' }),
  ]);
  expect(both.map((r) => r.status()).sort()).toEqual([200, 200]);
});

test('UPI: claim and QR only work while the QR is open', async ({ request }) => {
  const o = await (await place(request, { payMethod: 'upi' })).json();
  expect(o.status).toBe('pending_payment');
  const qr = await request.get(`/api/orders/${o.id}/upi`);
  expect(qr.headers()['content-type']).toContain('image/svg+xml');
  expect((await request.post(`/api/orders/${o.id}/claim`, { data: { action: 'steal' } })).status()).toBe(400);
  expect((await (await request.post(`/api/orders/${o.id}/claim`, { data: { action: 'paid' } })).json()).status).toBe(
    'awaiting_cash',
  );
  // a second claim (e.g. "cancel" from an expiring timer) can't undo it
  expect((await (await request.post(`/api/orders/${o.id}/claim`, { data: { action: 'cancel' } })).json()).status).toBe(
    'awaiting_cash',
  );
  expect((await request.get(`/api/orders/${o.id}/upi`)).status()).toBe(409);
});

test("the bill QR only encodes this site's own bill links", async ({ request, baseURL }) => {
  expect((await request.get(`/api/qr?u=${encodeURIComponent(`${baseURL}/r/${NIL}`)}`)).status()).toBe(200);
  for (const u of [`https://evil.example/r/${NIL}`, `${baseURL}/kitchen`, 'javascript:alert(1)', '']) {
    expect((await request.get(`/api/qr?u=${encodeURIComponent(u)}`)).status(), u).toBe(400);
  }
});

test("the TV's collected feed carries order numbers only", async ({ request }) => {
  const o = await (await place(request, { name: 'Private Name' })).json();
  for (const [from, to] of [
    ['awaiting_cash', 'new'],
    ['new', 'cooking'],
    ['cooking', 'ready'],
    ['ready', 'handed_over'],
  ])
    await status(request, o.id, { to, from });
  const list = await (await request.get('/api/orders?view=collected')).json();
  expect(list.length).toBeLessThanOrEqual(8);
  expect(list[0]).toEqual({ id: o.id, token: o.token });
  expect(JSON.stringify(list)).not.toContain('Private Name');
});

test('health reports setup without leaking secrets', async ({ request }) => {
  const r = await request.get('/api/health');
  expect(r.status()).toBe(200);
  const text = await r.text();
  expect(text).not.toContain(PIN);
  expect(JSON.parse(text)).toMatchObject({ ok: true, staffPin: 'set', database: 'ok' });
});
