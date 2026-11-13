// Easebuzz payment gateway: a UPI payment for one order, confirmed by Easebuzz itself (no staff tap).
// Server only: the salt signs every request and must never reach a browser.
//
// One order = one Easebuzz transaction. The transaction id is the order id without dashes, so a
// webhook or a status check leads straight back to its order with nothing extra stored.
//
// Docs (read 2026-11-14): https://docs.easebuzz.in/ → Payment Gateway → Initiate Payment API,
// Seamless Integration, Transaction API V2.1, Transaction Webhook. Notes in docs/payments.md.
import { createHash, timingSafeEqual } from 'node:crypto';

export interface EasebuzzConfig {
  key: string;
  salt: string;
  payUrl: string; // where payments are created and the customer pays
  dashUrl: string; // where a transaction's status is asked
  seamless: boolean; // true once Easebuzz enables "seamless" mode: we draw the QR ourselves
}

const HOSTS = {
  test: { payUrl: 'https://testpay.easebuzz.in', dashUrl: 'https://testdashboard.easebuzz.in' },
  live: { payUrl: 'https://pay.easebuzz.in', dashUrl: 'https://dashboard.easebuzz.in' },
};

// null when the keys aren't set: the caller falls back to the shop's own UPI QR.
export function easebuzzConfig(env: Record<string, string | undefined> = process.env): EasebuzzConfig | null {
  const key = env.EASEBUZZ_KEY?.trim();
  const salt = env.EASEBUZZ_SALT?.trim();
  if (!key || !salt) return null;
  const hosts = env.EASEBUZZ_ENV === 'live' ? HOSTS.live : HOSTS.test;
  return {
    key,
    salt,
    // overridable so the tests can point at a stand-in server
    payUrl: (env.EASEBUZZ_PAY_URL || hosts.payUrl).replace(/\/$/, ''),
    dashUrl: (env.EASEBUZZ_DASH_URL || hosts.dashUrl).replace(/\/$/, ''),
    seamless: env.EASEBUZZ_SEAMLESS === '1',
  };
}

const sha512 = (s: string) => createHash('sha512').update(s).digest('hex');

// ---- order id <-> transaction id ----
export const txnIdOf = (orderId: string) => orderId.replace(/-/g, '').toLowerCase(); // 32 chars (limit: 40)
export function orderIdOf(txnid: unknown): string | null {
  if (typeof txnid !== 'string' || !/^[0-9a-f]{32}$/.test(txnid)) return null;
  return `${txnid.slice(0, 8)}-${txnid.slice(8, 12)}-${txnid.slice(12, 16)}-${txnid.slice(16, 20)}-${txnid.slice(20)}`;
}

// Easebuzz wants the amount as a decimal string; ours are whole rupees.
export const amountOf = (total: number) => total.toFixed(1); // 219 → "219.0"

// ---- signatures ----
// Request: key|txnid|amount|productinfo|firstname|email|udf1…udf10|salt
export function requestHash(
  c: Pick<EasebuzzConfig, 'key' | 'salt'>,
  f: { txnid: string; amount: string; productinfo: string; firstname: string; email: string },
) {
  return sha512(
    [c.key, f.txnid, f.amount, f.productinfo, f.firstname, f.email, ...Array(10).fill(''), c.salt].join('|'),
  );
}
// Status request: key|txnid|salt
export const statusHash = (c: Pick<EasebuzzConfig, 'key' | 'salt'>, txnid: string) =>
  sha512(`${c.key}|${txnid}|${c.salt}`);
// Anything Easebuzz sends about a transaction (webhook, status reply) is signed in reverse:
// salt|status|udf10…udf1|email|firstname|productinfo|amount|txnid|key   (checked against the sandbox)
export function responseHash(c: Pick<EasebuzzConfig, 'salt'>, m: Record<string, string>) {
  const udf = Array.from({ length: 10 }, (_, i) => m[`udf${10 - i}`] ?? '');
  return sha512([c.salt, m.status, ...udf, m.email, m.firstname, m.productinfo, m.amount, m.txnid, m.key].join('|'));
}
export function signedByEasebuzz(c: EasebuzzConfig, m: Record<string, string>): boolean {
  if (typeof m.hash !== 'string' || m.key !== c.key) return false;
  const want = Buffer.from(responseHash(c, m));
  const got = Buffer.from(m.hash.toLowerCase());
  return want.length === got.length && timingSafeEqual(want, got);
}

// ---- what a transaction's status means for the order ----
export type PayState = 'paid' | 'failed' | 'waiting';
// success: money received. Everything that can still turn into a payment is "waiting". The rest
// (failure, userCancelled, dropped, bounced after the link expires…) never becomes one.
export function stateOf(status: string): PayState {
  if (status === 'success') return 'paid';
  if (['failure', 'userCancelled', 'dropped', 'autorefunded', 'refunded', 'reversed'].includes(status)) return 'failed';
  return 'waiting'; // preinitiated, initiated, pending, bounced (not paid yet) and anything new
}

export class EasebuzzError extends Error {}

async function post(url: string, form: Record<string, string>, timeoutMs = 8000): Promise<string> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(timeoutMs),
    cache: 'no-store',
  });
  const text = await r.text();
  if (!r.ok) throw new EasebuzzError(`Easebuzz answered ${r.status}`);
  return text;
}
const parse = (text: string): Record<string, unknown> => {
  try {
    const j: unknown = JSON.parse(text);
    if (j && typeof j === 'object' && !Array.isArray(j)) return j as Record<string, unknown>;
  } catch {
    /* not JSON: an error page */
  }
  throw new EasebuzzError('Easebuzz sent something unexpected');
};

export interface PaySession {
  // 'page': show Easebuzz's own payment page (works on every account).
  // 'qr': Easebuzz gave us the UPI link and we draw the QR (needs seamless mode on the account).
  kind: 'page' | 'qr';
  url: string; // the page to show, or the upi:// link to encode
}

// Start (or look up nothing: Easebuzz refuses a second start for the same order) the payment for an order.
export async function startPayment(
  c: EasebuzzConfig,
  o: { id: string; token: string; total: number; customerName: string | null },
  returnUrl: string,
): Promise<PaySession> {
  const f = {
    txnid: txnIdOf(o.id),
    amount: amountOf(o.total),
    productinfo: `Benne 14 order ${o.token}`.replace(/[^a-zA-Z0-9 |-]/g, '').slice(0, 45),
    firstname: (o.customerName ?? '').replace(/[^a-zA-Z0-9 ._-]/g, '').trim() || 'Customer',
    email: 'kiosk@benne14.in', // required by Easebuzz; the kiosk doesn't ask customers for one
  };
  const init = parse(
    await post(`${c.payUrl}/payment/initiateLink`, {
      key: c.key,
      ...f,
      phone: '9999999999',
      surl: returnUrl,
      furl: returnUrl,
      show_payment_mode: 'UPI',
      ...(c.seamless ? { request_flow: 'SEAMLESS' } : {}),
      hash: requestHash(c, f),
    }),
  );
  if (init.status !== 1 || typeof init.data !== 'string')
    throw new EasebuzzError(
      `Easebuzz refused the payment: ${String(init.error_desc ?? init.data ?? 'no reason given')}`,
    );
  const accessKey = init.data;
  if (!c.seamless) return { kind: 'page', url: `${c.payUrl}/pay/${accessKey}` };
  const qr = parse(
    await post(`${c.payUrl}/initiate_seamless_payment/`, {
      access_key: accessKey,
      payment_mode: 'UPI',
      upi_qr: 'true',
      request_mode: 'SUVA',
    }),
  );
  if (qr.status !== true || typeof qr.qr_link !== 'string' || !qr.qr_link.startsWith('upi://'))
    throw new EasebuzzError('Easebuzz did not return a UPI link');
  return { kind: 'qr', url: qr.qr_link };
}

export interface TxnStatus {
  state: PayState;
  status: string; // Easebuzz's own word
  amount: number;
  ref: string | null; // Easebuzz's payment id (easepayid), e.g. E2603240VUHFQ3
  bankRef: string | null; // the UPI reference customers see in their app
}

// Ask Easebuzz what happened to an order's payment. null: Easebuzz knows no such transaction.
// The answer is trusted only if Easebuzz signed it.
export async function fetchStatus(c: EasebuzzConfig, orderId: string): Promise<TxnStatus | null> {
  const txnid = txnIdOf(orderId);
  const j = parse(
    await post(`${c.dashUrl}/transaction/v2.1/retrieve`, { key: c.key, txnid, hash: statusHash(c, txnid) }),
  );
  const m = Array.isArray(j.msg) ? j.msg[0] : j.msg;
  if (j.status !== true || !m || typeof m !== 'object') return null;
  const row = m as Record<string, string>;
  if (row.txnid !== txnid || !signedByEasebuzz(c, row))
    throw new EasebuzzError('Easebuzz status reply is not signed correctly');
  return readTxn(row);
}

const na = (v: string | undefined) => (v && v !== 'NA' ? v : null);
export function readTxn(row: Record<string, string>): TxnStatus {
  return {
    state: stateOf(row.status),
    status: row.status,
    amount: Number(row.amount),
    ref: na(row.easepayid),
    bankRef: na(row.bank_ref_num),
  };
}
