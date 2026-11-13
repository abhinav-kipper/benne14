import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStore, StoreError } from '@/lib/store/memory';
import { priceOrder } from '@/lib/pricing';
import type { PlaceOrderInput } from '@/lib/orders';

const priced = priceOrder([{ itemId: 'masala-dosa', qty: 1, choices: {}, notes: [] }]);
const input = (key: string, payMethod: PlaceOrderInput['payMethod'] = 'upi'): PlaceOrderInput =>
  ({ key, type: 'takeaway', customerName: 'Rahul', payMethod, priced });

describe('memory store', () => {
  let s: MemoryStore;
  beforeEach(() => { s = new MemoryStore(); });

  it('numbers tokens per day and is idempotent on the checkout key', async () => {
    const a = await s.placeOrder(input('checkout-aaaa'));
    const again = await s.placeOrder(input('checkout-aaaa'));
    const b = await s.placeOrder(input('checkout-bbbb'));
    expect(a.token).toBe('1');
    expect(again.id).toBe(a.id);
    expect(b.token).toBe('2');
  });

  it('keeps unpaid orders off the cooking rail; they wait on the payment shelf', async () => {
    const upi = await s.placeOrder(input('checkout-upi1'));
    const cash = await s.placeOrder(input('checkout-cash', 'cash'));
    expect(upi.status).toBe('pending_payment');
    expect(cash.status).toBe('awaiting_cash');
    const rail = async () => (await s.listLive()).filter((o) => o.status === 'new' || o.status === 'cooking').map((o) => o.token);
    expect((await s.listLive()).map((o) => `${o.token}:${o.status}`)).toEqual(['1:pending_payment', '2:awaiting_cash']);
    expect(await rail()).toEqual([]);
    await s.setStatus(upi.id, 'awaiting_cash'); // customer: "I've paid"
    await s.setStatus(upi.id, 'new'); // counter: soundbox confirmed
    expect(await rail()).toEqual(['1']);
  });

  it('drops an abandoned UPI QR from the shelf when cancelled', async () => {
    const upi = await s.placeOrder(input('checkout-upi2'));
    await s.setStatus(upi.id, 'cancelled');
    expect(await s.listLive()).toEqual([]);
  });

  it("lists today's orders newest first, handed over and cancelled included", async () => {
    const a = await s.placeOrder(input('checkout-h1', 'cash'));
    const b = await s.placeOrder(input('checkout-h2', 'cash'));
    await s.setStatus(a.id, 'cancelled');
    for (const to of ['new', 'cooking', 'ready', 'handed_over'] as const) await s.setStatus(b.id, to);
    expect((await s.listToday()).map((o) => `${o.token}:${o.status}`)).toEqual(['2:handed_over', '1:cancelled']);
  });

  it('walks the kitchen flow and refuses impossible moves', async () => {
    const o = await s.placeOrder(input('checkout-flow'));
    await expect(s.setStatus(o.id, 'ready')).rejects.toBeInstanceOf(StoreError);
    await s.setStatus(o.id, 'new');
    await s.setStatus(o.id, 'cooking');
    const ready = await s.setStatus(o.id, 'ready');
    expect(ready.readyAt).not.toBeNull();
    const undone = await s.setStatus(o.id, 'cooking');
    expect(undone.readyAt).toBeNull();
  });

  describe('what the kitchen and board see over time', () => {
    afterEach(() => vi.useRealTimers());

    it('keeps an unpaid UPI QR on the shelf for 15 minutes, a collected order for 10', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-13T06:00:00Z'));
      const upi = await s.placeOrder(input('window-upi'));
      const done = await s.placeOrder(input('window-done', 'cash'));
      for (const to of ['new', 'cooking', 'ready', 'handed_over'] as const) await s.setStatus(done.id, to);
      const live = async () => (await s.listLive()).map((o) => o.id);
      expect(await live()).toEqual([upi.id, done.id]);
      vi.setSystemTime(new Date('2026-11-13T06:10:01Z'));
      expect(await live()).toEqual([upi.id]);
      vi.setSystemTime(new Date('2026-11-13T06:15:01Z'));
      expect(await live()).toEqual([]);
      expect(await s.listToday()).toHaveLength(2); // still in today's history
    });

    it('after midnight IST: numbers restart at 1, but unfinished orders stay on the kitchen screen', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-13T18:00:00Z')); // 23:30 IST
      const late = await s.placeOrder(input('day-1', 'cash'));
      await s.setStatus(late.id, 'new');
      vi.setSystemTime(new Date('2026-11-13T18:31:00Z')); // 00:01 IST next day
      const early = await s.placeOrder(input('day-2', 'cash'));
      expect([late.token, early.token]).toEqual(['1', '1']);
      expect((await s.listLive()).map((o) => o.id)).toEqual([late.id, early.id]); // the cook still sees last night's order
      expect((await s.listToday()).map((o) => o.id)).toEqual([early.id]); // history and takings are per day
    });

    it('drops an order nobody finished after 6 hours, so it does not haunt the next shift', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-13T06:00:00Z'));
      const o = await s.placeOrder(input('forgotten', 'cash'));
      await s.setStatus(o.id, 'new');
      vi.setSystemTime(new Date('2026-11-13T11:59:00Z'));
      expect(await s.listLive()).toHaveLength(1);
      vi.setSystemTime(new Date('2026-11-13T12:01:00Z'));
      expect(await s.listLive()).toHaveLength(0);
    });

    it('lists the whole day (no cap) and the last collected numbers for the TV', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 320; i++) ids.push((await s.placeOrder(input(`many-${i}`, 'cash'))).id);
      expect(await s.listToday()).toHaveLength(320);
      for (const id of ids.slice(0, 10)) for (const to of ['new', 'cooking', 'ready', 'handed_over'] as const) await s.setStatus(id, to);
      const c = await s.listCollected(8);
      expect(c).toHaveLength(8);
      expect(Object.keys(c[0]).sort()).toEqual(['id', 'token']); // numbers only: no names, items or amounts
    });
  });

  describe('owner dashboard', () => {
    it('records a refund once, only for paid orders', async () => {
      const paid = await s.placeOrder(input('own-paid', 'cash'));
      await s.setStatus(paid.id, 'new');
      const unpaid = await s.placeOrder(input('own-unpaid', 'cash'));
      await expect(s.refund(unpaid.id, 'x')).rejects.toMatchObject({ status: 409 });
      const r = await s.refund(paid.id, 'Wrong order');
      expect(r).toMatchObject({ refundReason: 'Wrong order', refundAmount: paid.total });
      await expect(s.refund(paid.id, 'again')).rejects.toMatchObject({ status: 409 });
    });

    it('keeps menu changes; sold out lasts for today only', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-13T06:00:00Z'));
      const edit = (patch: Parameters<typeof s.saveMenuEdit>[0]['patch']) => s.saveMenuEdit({ itemId: 'masala-dosa', patch, options: [], events: [] });
      await edit({ price: 219, soldOut: true });
      await edit({ name: 'Big Masala Dosa' });
      expect((await s.getOverrides()).items['masala-dosa']).toEqual({ name: 'Big Masala Dosa', desc: null, price: 219, soldOut: true });
      vi.setSystemTime(new Date('2026-11-13T19:00:00Z')); // 00:30 IST next day
      expect((await s.getOverrides()).items['masala-dosa'].soldOut).toBe(false);
      await edit({ price: null });
      expect((await s.getOverrides()).items['masala-dosa'].price).toBeNull();
      vi.useRealTimers();
    });

    it('saves a menu edit with its extras and history lines together', async () => {
      await s.saveMenuEdit({ itemId: 'plain-dosa', patch: { price: 179 }, options: [{ groupId: 'dosaExtras', optionId: 'benne', price: 30 }],
        events: [{ kind: 'price', subject: 'Plain Dosa', before: '₹169', after: '₹179' }, { kind: 'option_price', subject: 'Extra benne', before: '₹25', after: '₹30' }] });
      const o = await s.getOverrides();
      expect(o.items['plain-dosa'].price).toBe(179);
      expect(o.options['dosaExtras:benne']).toBe(30);
      expect((await s.listEvents()).map((e) => e.kind).sort()).toEqual(['option_price', 'price']);
    });

    it('lists orders in a date range, oldest first', async () => {
      const a = await s.placeOrder(input('own-range-1', 'cash'));
      const b = await s.placeOrder(input('own-range-2', 'cash'));
      const day = a.tokenDay;
      expect((await s.listRange(day, day)).map((o) => o.id)).toEqual([a.id, b.id]);
      expect(await s.listRange('2000-01-01', '2000-01-02')).toEqual([]);
    });
  });
});
