import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createHashOf,
  expiryOf,
  hashAmount,
  instaCollectConfig,
  lookupHashOf,
  orderOfWebhook,
  orderWebhookHash,
  readOrder,
  signedOrderWebhook,
  startCollect,
  upiLinkOf,
} from '@/lib/instacollect';

const sha = (s: string) => createHash('sha512').update(s).digest('hex');
const C = { key: 'KEY01', salt: 'SALT01' };

describe('InstaCollect: settings', () => {
  it('uses the gateway’s own key and salt, and is off without them', () => {
    expect(instaCollectConfig({ EASEBUZZ_KEY: ' k ', EASEBUZZ_SALT: 's' })).toEqual({
      key: 'k',
      salt: 's',
      wireUrl: 'https://wire.easebuzz.in',
    });
    expect(instaCollectConfig({ EASEBUZZ_KEY: 'k' })).toBeNull();
    // InstaCollect's own pair wins over the gateway's; half a pair is ignored
    const both = { EASEBUZZ_KEY: 'k', EASEBUZZ_SALT: 's', EASEBUZZ_WIRE_KEY: 'wk', EASEBUZZ_WIRE_SALT: 'ws' };
    expect(instaCollectConfig(both)).toMatchObject({ key: 'wk', salt: 'ws' });
    expect(instaCollectConfig({ ...both, EASEBUZZ_WIRE_SALT: '' })).toMatchObject({ key: 'k', salt: 's' });
    expect(
      instaCollectConfig({ EASEBUZZ_KEY: 'k', EASEBUZZ_SALT: 's', EASEBUZZ_WIRE_URL: 'http://x:1/' })?.wireUrl,
    ).toBe('http://x:1');
  });
});

describe('InstaCollect: signatures, as the docs spell them', () => {
  it('writes an amount inside a hash with at least one decimal', () => {
    expect([2, 219, 2.3, 2.34].map(hashAmount)).toEqual(['2.0', '219.0', '2.3', '2.34']);
  });

  it('create: key|unique_request_number|amount|per_transaction_amount|udf1…udf5|salt', () => {
    expect(createHashOf(C, 'abc123', '219.0')).toBe(sha('KEY01|abc123|219.0|219.0||||||SALT01'));
  });

  it('look-up and cancel: key|id|salt', () => {
    expect(lookupHashOf(C, 'order9')).toBe(sha('KEY01|order9|SALT01'));
  });

  it('order webhook: key|unique_request_number|amount|per_transaction_amount|status|udf1…udf5|salt', () => {
    const d = { merchant_request_number: 'abc123', amount: 219, per_transaction_amount: 219, status: 'completed' };
    const hash = sha('KEY01|abc123|219.0|219.0|completed||||||SALT01');
    expect(orderWebhookHash(C, d)).toBe(hash);
    expect(signedOrderWebhook(C, { ...d, Authorization: hash })).toBe(true);
    expect(signedOrderWebhook(C, { ...d, Authorization: hash.toUpperCase() })).toBe(true);
    // the amount written as it is sent, which is how the create call turned out to be signed
    expect(signedOrderWebhook(C, { ...d, Authorization: sha('KEY01|abc123|219|219|completed||||||SALT01') })).toBe(
      true,
    );
    // anything changed after signing, a missing signature, or another shop's keys: refused
    expect(signedOrderWebhook(C, { ...d, status: 'created', Authorization: hash })).toBe(false);
    expect(signedOrderWebhook(C, { ...d, amount: 1, Authorization: hash })).toBe(false);
    expect(signedOrderWebhook(C, d)).toBe(false);
    expect(signedOrderWebhook({ key: 'KEY01', salt: 'other' }, { ...d, Authorization: hash })).toBe(false);
  });

  it('leads a webhook back to our order, and ignores one that is not ours', () => {
    expect(orderOfWebhook({ merchant_request_number: '0123456789abcdef0123456789abcdef' })).toBe(
      '01234567-89ab-cdef-0123-456789abcdef',
    );
    expect(orderOfWebhook({ merchant_request_number: 'SM123' })).toBeNull();
    expect(orderOfWebhook({})).toBeNull();
  });
});

describe('InstaCollect: the QR', () => {
  it('uses the UPI link Easebuzz wraps in its payment link, amount included', () => {
    const inner = 'upi://pay?pa=20220419059150@yesbank&pn=Asha&tr=&am=219.0&cu=INR&tid=&tn=';
    const o = { payment_link: `https://wire.easebuzz.in/api/v1/deeplink/?upi_string=${encodeURIComponent(inner)}` };
    expect(upiLinkOf(o, 219, 'Order 7')).toBe(inner);
  });

  it('builds the link from the virtual UPI ID when there is no usable payment link', () => {
    const o = { payment_link: 'not a link', virtual_account: { upi_handle: '2026000001@yesbank' } };
    const link = upiLinkOf(o, 219, 'Order 7')!;
    const q = new URL(link.replace('upi://pay', 'http://x/')).searchParams;
    expect(link.startsWith('upi://pay?')).toBe(true);
    expect([q.get('pa'), q.get('am'), q.get('cu'), q.get('tn')]).toEqual([
      '2026000001@yesbank',
      '219.00',
      'INR',
      'Order 7',
    ]);
  });

  it('refuses to draw a QR for anything that is not a UPI ID', () => {
    expect(upiLinkOf({}, 219, 'x')).toBeNull();
    expect(upiLinkOf({ virtual_account: { upi_handle: 'javascript:alert(1)' } }, 219, 'x')).toBeNull();
    // a payment link pointing somewhere else entirely is not used
    expect(upiLinkOf({ payment_link: 'https://x.test/?upi_string=https%3A%2F%2Fevil.test' }, 219, 'x')).toBeNull();
  });

  it('gives the QR an end time in India’s clock, the way Easebuzz wants it written', () => {
    expect(expiryOf(Date.parse('2026-11-21T10:00:00Z'), 20)).toBe('2026-11-21 15:50:00');
    expect(expiryOf(Date.parse('2026-11-21T18:25:00Z'), 20)).toBe('2026-11-22 00:15:00'); // past midnight
  });
});

describe('InstaCollect: what an order’s state means for the bill', () => {
  const txn = (status: string, amount: number, n = 1) => ({
    id: `cvat${n}`,
    status,
    amount,
    unique_transaction_reference: `2313000${n}`,
  });

  it('is paid once money has arrived, whichever of Easebuzz’s two words it uses', () => {
    for (const status of ['received', 'unsettled'])
      expect(readOrder({ status: 'completed', transactions: [txn(status, 219)] })).toEqual({
        state: 'paid',
        status: 'completed',
        amount: 219,
        ref: 'cvat1',
        bankRef: '23130001',
      });
  });

  it('waits while nothing has arrived, or only something pending or failed', () => {
    expect(readOrder({ status: 'created', transactions: [] })).toMatchObject({
      state: 'waiting',
      amount: 0,
      ref: null,
    });
    expect(readOrder({ status: 'created', transactions: [txn('pending', 219)] }).state).toBe('waiting');
    expect(readOrder({ status: 'created', transactions: [txn('failure', 219)] }).state).toBe('waiting');
    expect(readOrder({ status: 'created' }).state).toBe('waiting');
  });

  it('is over when the QR was cancelled or ran out with nothing paid', () => {
    expect(readOrder({ status: 'cancelled', transactions: [] }).state).toBe('failed');
    expect(readOrder({ status: 'dropped', transactions: [] }).state).toBe('failed');
  });

  it('adds up everything paid, so a part payment or a second payment shows as a wrong amount', () => {
    expect(readOrder({ status: 'partially_completed', transactions: [txn('received', 100)] })).toMatchObject({
      state: 'paid',
      amount: 100,
    });
    const twice = readOrder({ status: 'completed', transactions: [txn('received', 219, 1), txn('unsettled', 219, 2)] });
    expect(twice).toMatchObject({ state: 'paid', amount: 438, ref: 'cvat1+cvat2' });
  });
});

describe('InstaCollect: starting a payment against a stand-in Easebuzz', () => {
  const cfg = { key: 'KEY01', salt: 'SALT01', wireUrl: 'http://wire.test' };
  const o = { id: '01234567-89ab-cdef-0123-456789abcdef', token: '7', total: 219, customerName: 'Asha <b>' };
  const urn = '0123456789abcdef0123456789abcdef';
  const ok = (order: object) => new Response(JSON.stringify({ success: true, data: { transaction_order: order } }));
  const no = (status: number, message: string) => new Response(JSON.stringify({ success: false, message }), { status });
  const made = {
    id: 'order1',
    status: 'created',
    virtual_account: { upi_handle: '2026000001@yesbank' },
    transactions: [],
  };
  const withFetch = async <T>(impl: typeof fetch, run: () => Promise<T>) => {
    const real = globalThis.fetch;
    globalThis.fetch = impl;
    try {
      return await run();
    } finally {
      globalThis.fetch = real;
    }
  };

  it('asks for this order, this amount, UPI only, and never sends the salt', async () => {
    const sent: { url: string; init: RequestInit }[] = [];
    const s = await withFetch(
      (async (url: string, init: RequestInit) => (sent.push({ url, init }), ok(made))) as typeof fetch,
      () => startCollect(cfg, o, '7428671414', Date.parse('2026-11-21T10:00:00Z')),
    );
    expect(s.kind).toBe('qr');
    expect(s.url).toContain('pa=2026000001%40yesbank');
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('http://wire.test/api/v1/insta-collect/order/create/');
    const body = JSON.parse(String(sent[0].init.body));
    expect(body).toEqual({
      key: 'KEY01',
      unique_request_number: urn,
      amount: 219,
      per_transaction_amount: 219,
      customer_name: 'Asha b',
      customer_phone: '7428671414',
      notify_customer_on_create: false,
      allowed_collection_modes: ['upi'],
      expiry_date: '2026-11-21 15:50:00',
    });
    expect((sent[0].init.headers as Record<string, string>).Authorization).toBe(createHashOf(cfg, urn, '219'));
    expect(JSON.stringify(sent)).not.toContain('SALT01');
  });

  it('tries the amount written the other way once, if Easebuzz turns the signature down', async () => {
    const hashes: string[] = [];
    await withFetch(
      (async (_u: string, init: RequestInit) => {
        hashes.push((init.headers as Record<string, string>).Authorization);
        return hashes.length === 1 ? no(401, 'Hash mismatch') : ok(made);
      }) as typeof fetch,
      () => startCollect(cfg, o, '7428671414'),
    );
    expect(hashes).toEqual([createHashOf(cfg, urn, '219'), createHashOf(cfg, urn, '219.0')]);
  });

  it('uses the QR already made when the order was started before, and says why when there is none', async () => {
    const again = await withFetch(
      (async (url: string) => (url.includes('/create/') ? no(400, 'already exists') : ok(made))) as typeof fetch,
      () => startCollect(cfg, o, '7428671414'),
    );
    expect(again.url).toContain('2026000001%40yesbank');
    await expect(
      withFetch((async () => no(400, 'InstaCollect is not enabled for this merchant')) as typeof fetch, () =>
        startCollect(cfg, o, '7428671414'),
      ),
    ).rejects.toThrow(/400 InstaCollect is not enabled for this merchant/);
    // a QR that was cancelled or has run out is not shown again
    await expect(
      withFetch(
        (async (url: string) =>
          url.includes('/create/') ? no(400, 'already exists') : ok({ ...made, status: 'cancelled' })) as typeof fetch,
        () => startCollect(cfg, o, '7428671414'),
      ),
    ).rejects.toThrow(/cancelled/);
  });
});
