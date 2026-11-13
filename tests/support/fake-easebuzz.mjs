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
let down = false;
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

  if (down) return send(res, 503, '<html>Service unavailable</html>', 'text/html');

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
