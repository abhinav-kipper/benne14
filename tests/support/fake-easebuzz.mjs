// A stand-in for Easebuzz, for the browser tests: the same endpoints, signatures and answers as the
// real gateway (docs/payments.md), plus a few "__" endpoints the tests use to play the customer
// (pay, fail, pay the wrong amount) and Easebuzz itself (send the webhook, go down).
// Run: node tests/support/fake-easebuzz.mjs   (port FAKE_EASEBUZZ_PORT, default 3199)
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

const KEY = process.env.EASEBUZZ_KEY ?? 'FAKEKEY01';
const SALT = process.env.EASEBUZZ_SALT ?? 'FAKESALT01';
const PORT = Number(process.env.FAKE_EASEBUZZ_PORT ?? 3199);
const sha512 = (s) => createHash('sha512').update(s).digest('hex');

const txns = new Map(); // txnid -> the fields Easebuzz keeps
const byAccess = new Map(); // access key -> txnid
const icOrders = new Map(); // InstaCollect: unique request number -> order
let down = false;
let icDown = false;
let seq = 0;

const body = (req) =>
  new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => (s += c));
    req.on('end', () => resolve(s));
  });
const form = (s) => Object.fromEntries(new URLSearchParams(s));
const send = (res, status, data, type = 'application/json') => {
  res.writeHead(status, { 'Content-Type': type });
  res.end(typeof data === 'string' ? data : JSON.stringify(data));
};
// what Easebuzz returns about a transaction, signed the way Easebuzz signs it
const signed = (t) => {
  const row = {
    txnid: t.txnid,
    key: KEY,
    status: t.status,
    amount: t.amount,
    email: t.email,
    firstname: t.firstname,
    productinfo: t.productinfo,
    mode: 'UPI',
    easepayid: t.status === 'success' ? t.easepayid : 'NA',
    bank_ref_num: t.status === 'success' ? '053462897602' : 'NA',
    ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`udf${i + 1}`, ''])),
  };
  const udf = Array(10).fill('');
  row.hash = sha512(
    [SALT, row.status, ...udf, row.email, row.firstname, row.productinfo, row.amount, row.txnid, row.key].join('|'),
  );
  return row;
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const raw = req.method === 'POST' ? await body(req) : '';

  // ---- test controls ----
  if (url.pathname === '/__down') {
    down = JSON.parse(raw || '{}').on !== false;
    return send(res, 200, { down });
  }
  if (url.pathname === '/__set') {
    // { txnid, status, amount? }: what the customer did
    const b = JSON.parse(raw);
    const t = txns.get(b.txnid);
    if (!t) return send(res, 404, { error: 'no such txn' });
    t.status = b.status;
    if (b.amount) t.amount = b.amount;
    return send(res, 200, { ok: true });
  }
  if (url.pathname === '/__webhook') {
    // { txnid, url, claim?, forge? }: Easebuzz notifies the shop. `claim` signs a status Easebuzz's own
    // records don't hold (a replayed or invented message); `forge` breaks the signature.
    const b = JSON.parse(raw);
    const t = txns.get(b.txnid) ?? {
      txnid: b.txnid,
      amount: '1.0',
      email: 'x@y.z',
      firstname: 'X',
      productinfo: 'X',
      easepayid: 'E0',
    };
    const row = signed({ ...t, status: b.claim ?? t.status });
    if (b.forge) row.hash = 'f'.repeat(128);
    const r = await fetch(b.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(row).toString(),
    });
    return send(res, 200, { status: r.status, body: await r.text() });
  }
  if (url.pathname === '/__txns') return send(res, 200, [...txns.values()]);
  // ---- InstaCollect test controls ----
  if (url.pathname === '/__ic/pay') {
    // { urn, amount?, status? }: the customer scans and pays (any amount: a UPI ID takes what it is sent)
    const b = JSON.parse(raw);
    const o = icOrders.get(b.urn);
    if (!o) return send(res, 404, { error: 'no such order' });
    if (o.status === 'cancelled') return send(res, 409, { error: 'closed: the bank sends this money back' });
    seq += 1;
    const amount = b.amount ?? o.amount;
    o.transactions.push({
      id: `cvatfake${String(seq).padStart(24, '0')}`,
      status: b.status ?? 'unsettled',
      payment_mode: 'UPI',
      amount,
      unique_transaction_reference: `2313${String(seq).padStart(8, '0')}`,
      remitter_upi_handle: 'asha@fake',
    });
    const got = o.transactions.reduce((a, t) => a + t.amount, 0);
    o.status = got >= o.amount ? 'completed' : 'partially_completed';
    return send(res, 200, { ok: true });
  }
  if (url.pathname === '/__ic/webhook') {
    // { urn, url, event?, claim?, forge? }: Easebuzz tells the shop about an order. `claim` signs a
    // status its own records don't hold; `forge` breaks the signature.
    const b = JSON.parse(raw);
    const o = icOrders.get(b.urn) ?? { urn: b.urn, id: 'orderfake0', amount: 1, transactions: [], status: 'created' };
    const status = b.claim ?? o.status;
    const amt = (n) => (Number.isInteger(n) ? n.toFixed(1) : String(n));
    const data = {
      id: o.id,
      amount: o.amount,
      status,
      merchant_request_number: o.urn,
      per_transaction_amount: o.amount,
      transactions: o.transactions,
      udf1: null,
      udf2: null,
      udf3: null,
      udf4: null,
      udf5: null,
      Authorization: b.forge
        ? 'f'.repeat(128)
        : sha512([KEY, o.urn, amt(o.amount), amt(o.amount), status, '', '', '', '', '', SALT].join('|')),
    };
    const r = await fetch(b.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: b.event ?? 'ORDER_STATUS_UPDATE', data }),
    });
    return send(res, 200, { status: r.status, body: await r.text() });
  }
  if (url.pathname === '/__ic/orders') return send(res, 200, [...icOrders.values()]);
  if (url.pathname === '/__ic/down') {
    icDown = JSON.parse(raw || '{}').on !== false;
    return send(res, 200, { down: icDown });
  }

  // each product goes down by itself: the two suites share this server and run side by side
  const forIc = url.pathname.startsWith('/api/v1/insta-collect/');
  if (forIc ? icDown : down) return send(res, 503, '<html>Service unavailable</html>', 'text/html');

  // ---- InstaCollect's own endpoints (wire.easebuzz.in) ----
  if (url.pathname.startsWith('/api/v1/insta-collect/order/')) {
    const auth = req.headers.authorization;
    const amt = (n) => (Number.isInteger(n) ? n.toFixed(1) : String(n));
    const shown = (o) => ({
      success: true,
      data: {
        transaction_order: {
          id: o.id,
          status: o.status,
          amount: o.amount,
          per_transaction_amount: o.amount,
          virtual_account: {
            account_number: '11122000220907149133',
            ifsc: 'YESB0CMSNOC',
            upi_handle: `${o.vpa}@fakebank`,
            upi_qrcode_url: `https://example.invalid/qr/${o.vpa}.png`,
          },
          transactions: o.transactions,
          payment_link: `http://localhost:${PORT}/api/v1/deeplink/?upi_string=${encodeURIComponent(
            `upi://pay?pa=${o.vpa}@fakebank&pn=${o.customer_name}&tr=&am=${amt(o.amount)}&cu=INR&tid=&tn=`,
          )}`,
          merchant_request_number: o.urn,
          customer_name: o.customer_name,
          customer_phone: o.customer_phone,
          allowed_collection_modes: o.modes,
          expiry_date: o.expiry_date,
        },
      },
    });
    const refuse = (message, status = 400) => send(res, status, { success: false, message });
    if (req.method === 'POST' && url.pathname === '/api/v1/insta-collect/order/create/') {
      const b = JSON.parse(raw || '{}');
      if (b.key !== KEY) return refuse('Invalid merchant key', 401);
      const want = sha512(
        [KEY, b.unique_request_number, amt(b.amount), amt(b.per_transaction_amount), '', '', '', '', '', SALT].join(
          '|',
        ),
      );
      if (auth !== want) return refuse('Hash mismatch', 401);
      if (!b.customer_name || !/^\d{10}$/.test(b.customer_phone ?? ''))
        return refuse('customer_name and customer_phone are required');
      if (!Array.isArray(b.allowed_collection_modes) || !b.allowed_collection_modes.length)
        return refuse('allowed_collection_modes is required');
      if (b.expiry_date && !/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(b.expiry_date))
        return refuse('expiry_date must be YYYY-MM-DD HH:MM:SS');
      if (icOrders.has(b.unique_request_number)) return refuse('Order with this unique request number already exists');
      seq += 1;
      const o = {
        urn: b.unique_request_number,
        id: `order${sha512(b.unique_request_number).slice(0, 27)}`,
        vpa: `2026${String(seq).padStart(10, '0')}`,
        amount: b.amount,
        status: 'created',
        transactions: [],
        customer_name: b.customer_name,
        customer_phone: b.customer_phone,
        modes: b.allowed_collection_modes,
        expiry_date: b.expiry_date ?? null,
      };
      icOrders.set(o.urn, o);
      return send(res, 200, shown(o));
    }
    const viaUrn = url.pathname.match(/^\/api\/v1\/insta-collect\/order\/retrieve_via_urn\/([^/]+)\/$/);
    if (req.method === 'GET' && viaUrn) {
      if (url.searchParams.get('key') !== KEY) return refuse('Invalid merchant key', 401);
      if (auth !== sha512(`${KEY}|${viaUrn[1]}|${SALT}`)) return refuse('Hash mismatch', 401);
      const o = icOrders.get(viaUrn[1]);
      return o ? send(res, 200, shown(o)) : refuse('Order not found', 404);
    }
    const cancel = url.pathname.match(/^\/api\/v1\/insta-collect\/order\/([^/]+)\/cancel\/$/);
    if (req.method === 'POST' && cancel) {
      if (auth !== sha512(`${KEY}|${cancel[1]}|${SALT}`)) return refuse('Hash mismatch', 401);
      const o = [...icOrders.values()].find((x) => x.id === cancel[1]);
      if (!o) return refuse('Order not found', 404);
      if (o.status !== 'created') return refuse('Order cannot be cancelled');
      o.status = 'cancelled';
      return send(res, 200, shown(o));
    }
    return refuse('Not found', 404);
  }

  // ---- Easebuzz's own endpoints ----
  if (req.method === 'POST' && url.pathname === '/payment/initiateLink') {
    const f = form(raw);
    const want = sha512(
      [KEY, f.txnid, f.amount, f.productinfo, f.firstname, f.email, ...Array(10).fill(''), SALT].join('|'),
    );
    if (f.key !== KEY)
      return send(res, 200, { status: 0, error_desc: 'Invalid merchant key.', data: 'Parameter validation failed' });
    if (f.hash !== want)
      return send(res, 200, {
        status: 0,
        error_desc: 'Payment cannot be verified. Hash mismatch.',
        data: 'Parameter validation failed',
      });
    if (txns.has(f.txnid))
      return send(res, 200, {
        status: 0,
        data: 'Transaction cannot be processed. Duplicate transaction id.',
        error_desc: 'Kindly retry your transaction.',
      });
    const access = sha512(`access-${f.txnid}`).slice(0, 64);
    seq += 1;
    txns.set(f.txnid, {
      txnid: f.txnid,
      amount: f.amount,
      email: f.email,
      firstname: f.firstname,
      productinfo: f.productinfo,
      status: 'preinitiated',
      easepayid: `E26FAKE${String(seq).padStart(6, '0')}`,
      seamless: f.request_flow === 'SEAMLESS',
    });
    byAccess.set(access, f.txnid);
    return send(res, 200, { status: 1, data: access });
  }
  if (req.method === 'POST' && url.pathname === '/initiate_seamless_payment/') {
    const t = txns.get(byAccess.get(form(raw).access_key));
    if (!t?.seamless) return send(res, 200, '<html>Error Unauthorized Access</html>', 'text/html');
    return send(res, 200, {
      status: true,
      msg_desc: 'Scan the QR Code on any UPI Application',
      qr_link: `upi://pay?pa=benne14@fake&pn=Benne%2014&am=${t.amount}&cu=INR&tr=${t.txnid}`,
    });
  }
  if (req.method === 'GET' && url.pathname.startsWith('/pay/')) {
    const t = txns.get(byAccess.get(url.pathname.slice(5)));
    if (!t) return send(res, 404, '<html>Invalid link</html>', 'text/html');
    return send(
      res,
      200,
      `<!doctype html><meta charset="utf-8"><body style="font:20px sans-serif;text-align:center;padding:40px">
       <h2>Fake Easebuzz</h2><p data-testid="fake-amount">Pay ₹ ${t.amount}</p><p>Tr ID ${t.txnid}</p></body>`,
      'text/html',
    );
  }
  if (req.method === 'POST' && url.pathname === '/transaction/v2.1/retrieve') {
    const f = form(raw);
    if (f.hash !== sha512(`${KEY}|${f.txnid}|${SALT}`)) return send(res, 200, { status: false, msg: 'Hash mismatch' });
    const t = txns.get(f.txnid);
    if (!t) return send(res, 200, { status: false, msg: 'Transaction not found' });
    return send(res, 200, { status: true, msg: [signed(t)] });
  }
  send(res, 404, { error: 'not found' });
}).listen(PORT, () => console.log(`fake Easebuzz on :${PORT}`));
