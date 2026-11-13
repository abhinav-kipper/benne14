import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  amountOf,
  easebuzzConfig,
  EasebuzzError,
  fetchStatus,
  orderIdOf,
  requestHash,
  responseHash,
  signedByEasebuzz,
  startPayment,
  stateOf,
  statusHash,
  txnIdOf,
} from '@/lib/easebuzz';

// Made-up credentials: these tests never call Easebuzz. The hash sequences were checked against
// Easebuzz's sandbox on 2026-11-14 (docs/payments.md).
const cfg = easebuzzConfig({ EASEBUZZ_KEY: 'KEY123', EASEBUZZ_SALT: 'SALT456' })!;
const sha512 = (s: string) => createHash('sha512').update(s).digest('hex');
const ORDER = '3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f';
const order = { id: ORDER, token: '42', total: 219, customerName: 'Asha' };

const row = (over: Record<string, string> = {}) => {
  const m: Record<string, string> = {
    txnid: txnIdOf(ORDER),
    key: 'KEY123',
    status: 'success',
    amount: '219.0',
    email: 'kiosk@benne14.in',
    firstname: 'Asha',
    productinfo: 'Benne 14 order 42',
    easepayid: 'E2603240VUHFQ3',
    bank_ref_num: '053462897602',
    ...over,
  };
  return { ...m, hash: responseHash(cfg, m) };
};
const reply = (body: unknown, ok = true) =>
  ({
    ok,
    status: ok ? 200 : 503,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }) as Response;

afterEach(() => vi.unstubAllGlobals());

describe('Easebuzz: configuration', () => {
  it('is off without both keys, and picks test or live hosts', () => {
    expect(easebuzzConfig({})).toBeNull();
    expect(easebuzzConfig({ EASEBUZZ_KEY: 'k' })).toBeNull();
    expect(cfg).toMatchObject({
      payUrl: 'https://testpay.easebuzz.in',
      dashUrl: 'https://testdashboard.easebuzz.in',
      seamless: false,
    });
    expect(
      easebuzzConfig({ EASEBUZZ_KEY: ' k ', EASEBUZZ_SALT: 's', EASEBUZZ_ENV: 'live', EASEBUZZ_SEAMLESS: '1' }),
    ).toMatchObject({
      key: 'k',
      payUrl: 'https://pay.easebuzz.in',
      dashUrl: 'https://dashboard.easebuzz.in',
      seamless: true,
    });
  });
});

describe('Easebuzz: ids, amounts and signatures', () => {
  it('turns an order id into a transaction id and back, and refuses anything else', () => {
    expect(txnIdOf(ORDER)).toBe('3f2a9c1e7b4d4e8a9c0f1a2b3c4d5e6f');
    expect(txnIdOf(ORDER).length).toBeLessThanOrEqual(40);
    expect(orderIdOf(txnIdOf(ORDER))).toBe(ORDER);
    for (const bad of ['', 'LINK-FROM-DASHBOARD', '3f2a9c1e7b4d4e8a9c0f1a2b3c4d5e6', `${txnIdOf(ORDER)}0`, 42, null])
      expect(orderIdOf(bad), String(bad)).toBeNull();
  });

  it('sends whole-rupee amounts the way Easebuzz echoes them', () => {
    expect([1, 219, 1000].map(amountOf)).toEqual(['1.0', '219.0', '1000.0']);
  });

  it('signs requests and status calls in Easebuzz’s documented order', () => {
    const f = { txnid: 'T1', amount: '219.0', productinfo: 'P', firstname: 'F', email: 'e@x.y' };
    expect(requestHash(cfg, f)).toBe(sha512('KEY123|T1|219.0|P|F|e@x.y|||||||||||SALT456'));
    expect(statusHash(cfg, 'T1')).toBe(sha512('KEY123|T1|SALT456'));
    const m = {
      status: 'success',
      email: 'e@x.y',
      firstname: 'F',
      productinfo: 'P',
      amount: '219.0',
      txnid: 'T1',
      key: 'KEY123',
      udf1: 'a',
    };
    expect(responseHash(cfg, m)).toBe(sha512('SALT456|success||||||||||a|e@x.y|F|P|219.0|T1|KEY123'));
  });

  it('accepts only what Easebuzz signed: any changed field breaks the signature', () => {
    expect(signedByEasebuzz(cfg, row())).toBe(true);
    for (const tampered of [
      { ...row(), amount: '1.0' },
      { ...row(), status: 'failure' },
      { ...row({ status: 'failure' }), status: 'success' }, // a failed payment relabelled as paid
      { ...row(), txnid: txnIdOf('00000000-0000-4000-8000-000000000000') }, // someone else's order
      { ...row(), key: 'OTHERKEY' },
      { ...row(), hash: 'f'.repeat(128) },
      (({ hash: _h, ...rest }) => rest)(row()),
    ])
      expect(signedByEasebuzz(cfg, tampered as Record<string, string>)).toBe(false);
  });

  it('reads only "success" as paid; a status it doesn’t know keeps waiting, never "failed" by mistake', () => {
    expect(stateOf('success')).toBe('paid');
    for (const s of ['failure', 'userCancelled', 'dropped']) expect(stateOf(s), s).toBe('failed');
    for (const s of ['preinitiated', 'initiated', 'pending', 'bounced', 'something_new', ''])
      expect(stateOf(s), s).toBe('waiting');
  });
});

describe('Easebuzz: starting a payment and asking its status (network stubbed)', () => {
  it('starts a payment for the order’s exact amount and returns the page to show', async () => {
    const calls: [string, URLSearchParams][] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push([url, new URLSearchParams(init.body as string)]);
      return reply({ status: 1, data: 'ACCESSKEY' });
    });
    expect(await startPayment(cfg, order, 'https://shop/return')).toEqual({
      kind: 'page',
      url: 'https://testpay.easebuzz.in/pay/ACCESSKEY',
    });
    const [url, f] = calls[0];
    expect(url).toBe('https://testpay.easebuzz.in/payment/initiateLink');
    expect(Object.fromEntries(f)).toMatchObject({
      key: 'KEY123',
      txnid: txnIdOf(ORDER),
      amount: '219.0',
      productinfo: 'Benne 14 order 42',
      firstname: 'Asha',
      show_payment_mode: 'UPI',
      surl: 'https://shop/return',
    });
    expect(f.get('hash')).toBe(
      requestHash(cfg, {
        txnid: txnIdOf(ORDER),
        amount: '219.0',
        productinfo: 'Benne 14 order 42',
        firstname: 'Asha',
        email: f.get('email')!,
      }),
    );
    expect(f.has('request_flow')).toBe(false);
    expect([...f.values()].join(' ')).not.toContain('SALT456'); // the salt never leaves the server
  });

  it('in seamless mode asks for the UPI link and returns it for our own QR', async () => {
    const seamless = { ...cfg, seamless: true };
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url);
      return url.endsWith('/payment/initiateLink')
        ? reply({ status: 1, data: 'AK' })
        : reply({ status: true, qr_link: 'upi://pay?pa=x@y&am=219.0' });
    });
    expect(await startPayment(seamless, order, 'https://shop/return')).toEqual({
      kind: 'qr',
      url: 'upi://pay?pa=x@y&am=219.0',
    });
    expect(urls[1]).toBe('https://testpay.easebuzz.in/initiate_seamless_payment/');
  });

  it('fails clearly when Easebuzz refuses, answers with an error page, or is down', async () => {
    for (const r of [
      reply({ status: 0, error_desc: 'Payment cannot be verified. Hash mismatch.' }),
      reply('<html>Error Unauthorized Access</html>'),
      reply('down', false),
    ]) {
      vi.stubGlobal('fetch', async () => r);
      await expect(startPayment(cfg, order, 'https://shop/return')).rejects.toBeInstanceOf(EasebuzzError);
    }
    // seamless not enabled on the account: an error page instead of the UPI link
    vi.stubGlobal('fetch', async (url: string) =>
      url.endsWith('initiateLink') ? reply({ status: 1, data: 'AK' }) : reply('<html>Unauthorized</html>'),
    );
    await expect(startPayment({ ...cfg, seamless: true }, order, 'https://shop/return')).rejects.toBeInstanceOf(
      EasebuzzError,
    );
  });

  it('reads a signed status reply; an unsigned or mismatched one is refused, an unknown payment is null', async () => {
    vi.stubGlobal('fetch', async () => reply({ status: true, msg: [row()] }));
    expect(await fetchStatus(cfg, ORDER)).toEqual({
      state: 'paid',
      status: 'success',
      amount: 219,
      ref: 'E2603240VUHFQ3',
      bankRef: '053462897602',
    });
    vi.stubGlobal('fetch', async () =>
      reply({ status: true, msg: [row({ status: 'preinitiated', easepayid: 'NA', bank_ref_num: 'NA' })] }),
    );
    expect(await fetchStatus(cfg, ORDER)).toMatchObject({ state: 'waiting', ref: null, bankRef: null });
    vi.stubGlobal('fetch', async () => reply({ status: false, msg: 'Transaction not found' }));
    expect(await fetchStatus(cfg, ORDER)).toBeNull();
    vi.stubGlobal('fetch', async () => reply({ status: true, msg: [{ ...row(), amount: '1.0' }] })); // tampered on the way
    await expect(fetchStatus(cfg, ORDER)).rejects.toBeInstanceOf(EasebuzzError);
    vi.stubGlobal('fetch', async () => reply({ status: true, msg: [row({ txnid: 'someoneelse' })] })); // another payment's answer
    await expect(fetchStatus(cfg, ORDER)).rejects.toBeInstanceOf(EasebuzzError);
  });
});

describe('payments still open are re-checked by the screens that are always on', () => {
  it('picks UPI orders still waiting, each at most once per 15 seconds, and nothing without a gateway', async () => {
    vi.stubEnv('EASEBUZZ_KEY', 'KEY123');
    vi.stubEnv('EASEBUZZ_SALT', 'SALT456');
    const { ordersToRecheck } = await import('@/lib/gateway');
    const orders = [
      { id: 'a', status: 'pending_payment', payMethod: 'upi' },
      { id: 'b', status: 'awaiting_cash', payMethod: 'cash' }, // paid at the counter: not the gateway's
      { id: 'c', status: 'new', payMethod: 'upi' }, // already paid
      { id: 'd', status: 'pending_payment', payMethod: 'upi' },
    ] as const;
    const t0 = 1_000_000;
    expect(ordersToRecheck([...orders], t0)).toEqual(['a', 'd']);
    expect(ordersToRecheck([...orders], t0 + 5_000)).toEqual([]); // the kitchen polls every 1.5 s: don't hammer the gateway
    expect(ordersToRecheck([...orders], t0 + 15_000)).toEqual(['a', 'd']);
    vi.unstubAllEnvs();
    vi.stubEnv('EASEBUZZ_KEY', '');
    expect(ordersToRecheck([{ id: 'z', status: 'pending_payment', payMethod: 'upi' }], t0)).toEqual([]);
    vi.unstubAllEnvs();
  });
});
