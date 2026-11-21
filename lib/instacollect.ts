// Easebuzz InstaCollect: a UPI QR for one order, paid straight into a virtual UPI ID of the shop's
// Easebuzz account, confirmed by Easebuzz itself. The other way to take UPI (lib/easebuzz.ts is the
// payment gateway); PAYMENTS=instacollect picks this one. Same key and salt as the gateway.
// Server only: the salt signs every request and must never reach a browser.
//
// One order = one InstaCollect "order" (their name for a dynamic QR). Its unique request number is
// our order id without dashes, so a webhook or a look-up leads straight back to the order with
// nothing extra stored.
//
// Docs (read 2026-11-21): https://docs.easebuzz.in/docs/neobanking → APIs → InstaCollect (QR) →
// Orders (Dynamic QR): Create Order, Retrieve Order by URN, Cancel Order by ID; Webhooks →
// InstaCollect Orders (Dynamic QR) Webhooks. Notes in docs/payments.md.
import { createHash, timingSafeEqual } from 'node:crypto';
import { EasebuzzError, orderIdOf, txnIdOf, type PaySession, type PayState, type TxnStatus } from './easebuzz';

export interface InstaCollectConfig {
  key: string;
  salt: string;
  wireUrl: string;
}

export function instaCollectConfig(env: Record<string, string | undefined> = process.env): InstaCollectConfig | null {
  // InstaCollect runs on Easebuzz's "Wire" product, which has its own key and salt; the gateway's
  // are refused there ("Invalid key"). The gateway pair is only a fallback for an account where
  // Easebuzz made them the same.
  const wire = env.EASEBUZZ_WIRE_KEY?.trim() && env.EASEBUZZ_WIRE_SALT?.trim();
  const key = (wire ? env.EASEBUZZ_WIRE_KEY : env.EASEBUZZ_KEY)?.trim();
  const salt = (wire ? env.EASEBUZZ_WIRE_SALT : env.EASEBUZZ_SALT)?.trim();
  if (!key || !salt) return null;
  // overridable so the tests can point at a stand-in server
  return { key, salt, wireUrl: (env.EASEBUZZ_WIRE_URL || 'https://wire.easebuzz.in').replace(/\/$/, '') };
}

const sha512 = (s: string) => createHash('sha512').update(s).digest('hex');
type Keys = Pick<InstaCollectConfig, 'key' | 'salt'>;

// ---- signatures ----
// Amounts inside a hash are written with at least one decimal: 2 → "2.0", 2.3 → "2.3" (their table).
export const hashAmount = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));
// Create: key|unique_request_number|amount|per_transaction_amount|udf1|udf2|udf3|udf4|udf5|salt
export const createHashOf = (c: Keys, urn: string, amount: string) =>
  sha512([c.key, urn, amount, amount, '', '', '', '', '', c.salt].join('|'));
// Look-up and cancel: key|<id or unique request number>|salt
export const lookupHashOf = (c: Keys, id: string) => sha512(`${c.key}|${id}|${c.salt}`);
// An order webhook: key|unique_request_number|amount|per_transaction_amount|status|udf1…udf5|salt
// `plain` writes a whole amount as "219" instead of "219.0": the docs show the second, but the
// create call turned out to want the first, so a webhook signed either way is accepted.
export function orderWebhookHash(c: Keys, d: Record<string, unknown>, plain = false) {
  const amt = (v: unknown) =>
    typeof v === 'number' ? (plain ? String(v) : hashAmount(v)) : v == null ? '' : String(v);
  const udf = [d.udf1, d.udf2, d.udf3, d.udf4, d.udf5].map((u) => (u == null ? '' : String(u)));
  return sha512(
    [
      c.key,
      String(d.merchant_request_number ?? ''),
      amt(d.amount),
      amt(d.per_transaction_amount),
      String(d.status ?? ''),
      ...udf,
      c.salt,
    ].join('|'),
  );
}
export function signedOrderWebhook(c: Keys, d: Record<string, unknown>): boolean {
  if (typeof d.Authorization !== 'string') return false;
  const got = Buffer.from(d.Authorization.toLowerCase());
  return [false, true].some((plain) => {
    const want = Buffer.from(orderWebhookHash(c, d, plain));
    return want.length === got.length && timingSafeEqual(want, got);
  });
}

// ---- talking to Easebuzz ----
async function call(
  c: InstaCollectConfig,
  method: 'GET' | 'POST',
  path: string,
  hash: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const url = `${c.wireUrl}${path}${method === 'GET' ? `?key=${encodeURIComponent(c.key)}` : ''}`;
  const r = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      Authorization: hash,
      'WIRE-API-KEY': c.key,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
    cache: 'no-store',
  });
  const text = await r.text();
  let json: Record<string, unknown> = {};
  try {
    const j: unknown = JSON.parse(text);
    if (j && typeof j === 'object' && !Array.isArray(j)) json = j as Record<string, unknown>;
  } catch {
    if (r.ok) throw new EasebuzzError('InstaCollect sent something unexpected');
  }
  return { status: r.status, json };
}
const orderIn = (j: Record<string, unknown>): Record<string, unknown> | null => {
  const d = j.data as { transaction_order?: unknown } | undefined;
  const o = j.success === true && d && typeof d === 'object' ? d.transaction_order : null;
  return o && typeof o === 'object' ? (o as Record<string, unknown>) : null;
};
// Why Easebuzz said no, in their words, for the server log and the technical page.
const reason = (r: { status: number; json: Record<string, unknown> }) =>
  `${r.status} ${String(r.json.message ?? r.json.error ?? r.json.detail ?? JSON.stringify(r.json)).slice(0, 200)}`;

// Easebuzz's time for "this QR stops working": India time, no zone.
export const expiryOf = (now: number, minutes: number) =>
  new Date(now + minutes * 60_000 + 5.5 * 3600_000).toISOString().slice(0, 19).replace('T', ' ');
const QR_MINUTES = 20;

// The upi:// link to draw as a QR. Easebuzz gives a "payment_link" that wraps it (amount included);
// if that ever changes shape, it is built from the virtual UPI ID they also return.
export function upiLinkOf(o: Record<string, unknown>, total: number, note: string): string | null {
  try {
    const inner = new URL(String(o.payment_link)).searchParams.get('upi_string');
    if (inner && inner.startsWith('upi://pay?') && /[?&]pa=[^&]+/.test(inner) && /[?&]am=[\d.]+/.test(inner))
      return inner;
  } catch {
    /* no usable payment_link: fall through */
  }
  const handle = (o.virtual_account as { upi_handle?: unknown } | undefined)?.upi_handle;
  if (typeof handle !== 'string' || !/^[\w.-]+@[\w.-]+$/.test(handle)) return null;
  const q = new URLSearchParams({ pa: handle, pn: 'Benne 14', am: total.toFixed(2), cu: 'INR', tn: note });
  return `upi://pay?${q.toString()}`;
}

// Start the payment for an order: one call, and Easebuzz answers with the UPI ID to pay into.
// Asked again for the same order (a reloaded kiosk, another server), the order already made is used.
export async function startCollect(
  c: InstaCollectConfig,
  o: { id: string; token: string; total: number; customerName: string | null },
  phone: string,
  now = Date.now(),
): Promise<PaySession> {
  const urn = txnIdOf(o.id);
  const body = {
    key: c.key,
    unique_request_number: urn,
    amount: o.total,
    per_transaction_amount: o.total, // one payment, of exactly the bill
    // Easebuzz asks for a name and a phone number for every order; the kiosk does not ask customers
    // for either, so the name is the guest's (or "Guest") and the number is the shop's own.
    customer_name: (o.customerName ?? '').replace(/[^a-zA-Z0-9 ._-]/g, '').trim() || 'Guest',
    customer_phone: phone,
    notify_customer_on_create: false,
    allowed_collection_modes: ['upi'],
    expiry_date: expiryOf(now, QR_MINUTES),
  };
  const create = (amount: string) =>
    call(c, 'POST', '/api/v1/insta-collect/order/create/', createHashOf(c, urn, amount), body);
  // The real Easebuzz wants the amount inside this signature written as it is sent ("219"): it
  // refused "1.0" and took "1" (checked 2026-11-21). Their docs show "219.0" for webhooks, so if
  // the signature is ever turned down it is tried once more that way.
  let made = await create(String(o.total));
  if (!orderIn(made.json) && (made.status === 401 || made.status === 403)) made = await create(hashAmount(o.total));
  let order = orderIn(made.json);
  if (!order) {
    // Refused: most often because this order's QR was already made. Use that one if it exists.
    const had = await call(c, 'GET', `/api/v1/insta-collect/order/retrieve_via_urn/${urn}/`, lookupHashOf(c, urn));
    order = orderIn(had.json);
    if (!order) throw new EasebuzzError(`InstaCollect refused the order: ${reason(made)}`);
    if (['cancelled', 'dropped'].includes(String(order.status)))
      throw new EasebuzzError(`InstaCollect: this order's QR is ${String(order.status)}`);
  }
  const link = upiLinkOf(order, o.total, `Order ${o.token}`);
  if (!link) throw new EasebuzzError('InstaCollect did not return a UPI ID to pay into');
  return { kind: 'qr', url: link };
}

// What Easebuzz knows about an order's payment. null: it has no such order.
// A payment counts once its transaction is "received" or "unsettled" (their two words for money
// that has arrived); everything paid against the order is added up, so a second or a part payment
// shows as a wrong amount and is flagged instead of accepted.
const ARRIVED = ['received', 'unsettled'];
export function readOrder(o: Record<string, unknown>): TxnStatus {
  const txns = (Array.isArray(o.transactions) ? o.transactions : []) as Record<string, unknown>[];
  const paid = txns.filter((t) => ARRIVED.includes(String(t.status)));
  const status = String(o.status ?? '');
  const state: PayState = paid.length ? 'paid' : ['cancelled', 'dropped'].includes(status) ? 'failed' : 'waiting';
  const str = (v: unknown) => (typeof v === 'string' && v && v !== 'NA' ? v : null);
  return {
    state,
    status,
    amount: paid.reduce((a, t) => a + Number(t.amount), 0),
    ref: paid.length
      ? paid
          .map((t) => str(t.id))
          .filter(Boolean)
          .join('+') || null
      : null,
    bankRef: paid.length ? str(paid[0].unique_transaction_reference) : null,
  };
}
export async function fetchCollect(c: InstaCollectConfig, orderId: string): Promise<TxnStatus | null> {
  const urn = txnIdOf(orderId);
  const r = await call(c, 'GET', `/api/v1/insta-collect/order/retrieve_via_urn/${urn}/`, lookupHashOf(c, urn));
  const o = orderIn(r.json);
  if (!o) {
    if (r.status === 404 || r.status === 400 || r.json.success === false) return null;
    throw new EasebuzzError(`InstaCollect look-up failed: ${reason(r)}`);
  }
  return readOrder(o);
}

// Close an order's QR so a late scan cannot pay it (Easebuzz sends such money back). Best effort.
export async function cancelCollect(c: InstaCollectConfig, orderId: string): Promise<boolean> {
  const urn = txnIdOf(orderId);
  const had = orderIn(
    (await call(c, 'GET', `/api/v1/insta-collect/order/retrieve_via_urn/${urn}/`, lookupHashOf(c, urn))).json,
  );
  const id = had && typeof had.id === 'string' ? had.id : null;
  if (!id || String(had!.status) !== 'created') return false;
  const r = await call(c, 'POST', `/api/v1/insta-collect/order/${id}/cancel/`, lookupHashOf(c, id), { key: c.key });
  return !!orderIn(r.json);
}

// Which of our orders a webhook is about (null: not one of ours, e.g. a QR made in their dashboard).
export const orderOfWebhook = (d: Record<string, unknown>) => orderIdOf(d.merchant_request_number);

// ---- "Does it work with our keys?" ----
// A check the owner can run from the technical page, against the real Easebuzz, with no customer
// and no money: look up an order that does not exist (are the keys accepted?), make a ₹1 QR
// (is the request signed the way Easebuzz wants?), then cancel that QR. Each step says what
// Easebuzz answered, in its own words.
export interface CheckStep {
  step: string;
  ok: boolean;
  detail: string;
}
export async function selfCheck(c: InstaCollectConfig, phone: string, now = Date.now()): Promise<CheckStep[]> {
  const out: CheckStep[] = [];
  const attempt = async (step: string, run: () => Promise<{ ok: boolean; detail: string }>) => {
    try {
      out.push({ step, ...(await run()) });
    } catch (e) {
      out.push({ step, ok: false, detail: e instanceof Error ? e.message : String(e) });
    }
    return out[out.length - 1].ok;
  };
  const urn = `benne14check${now.toString(36)}`.slice(0, 32);

  const keysOk = await attempt('Keys accepted', async () => {
    const r = await call(c, 'GET', `/api/v1/insta-collect/order/retrieve_via_urn/${urn}/`, lookupHashOf(c, urn));
    // "no such order" is the right answer here; "not authorised" means the keys or InstaCollect itself are the problem
    const refused = r.status === 401 || r.status === 403;
    const unwell = r.status >= 500; // their server is down or erroring: nothing can be concluded about the keys
    return { ok: !refused && !unwell, detail: `Easebuzz answered ${reason(r)}` };
  });
  if (!keysOk) return out;

  let orderId: string | null = null;
  const made = await attempt('A ₹1 QR can be made', async () => {
    const body = {
      key: c.key,
      unique_request_number: urn,
      amount: 1,
      per_transaction_amount: 1,
      customer_name: 'Benne 14 check',
      customer_phone: phone,
      notify_customer_on_create: false,
      allowed_collection_modes: ['upi'],
      expiry_date: expiryOf(now, 5),
    };
    const tries: string[] = [];
    for (const amount of ['1', '1.0']) {
      const r = await call(c, 'POST', '/api/v1/insta-collect/order/create/', createHashOf(c, urn, amount), body);
      const o = orderIn(r.json);
      if (o) {
        orderId = typeof o.id === 'string' ? o.id : null;
        const link = upiLinkOf(o, 1, 'Check');
        return {
          ok: !!link,
          detail: `${link ? 'Easebuzz gave a UPI ID to pay into' : 'Made, but no UPI ID came back'} (amount signed as "${amount}")`,
        };
      }
      tries.push(`signed as "${amount}": ${reason(r)}`);
      if (r.status !== 401 && r.status !== 403) break; // not a signature problem: the other format won't help
    }
    return { ok: false, detail: tries.join(' · ') };
  });
  if (!made || !orderId) return out;

  await attempt('That QR can be cancelled', async () => {
    const id = orderId!;
    const r = await call(c, 'POST', `/api/v1/insta-collect/order/${id}/cancel/`, lookupHashOf(c, id), { key: c.key });
    const o = orderIn(r.json);
    return { ok: !!o, detail: o ? `Cancelled (${String(o.status)})` : `Easebuzz answered ${reason(r)}` };
  });
  return out;
}
