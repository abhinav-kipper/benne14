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

    it("starts numbering again at 1 after midnight IST and hides yesterday's orders", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-13T18:00:00Z')); // 23:30 IST
      const late = await s.placeOrder(input('day-1', 'cash'));
      await s.setStatus(late.id, 'new');
      vi.setSystemTime(new Date('2026-11-13T18:31:00Z')); // 00:01 IST next day
      const early = await s.placeOrder(input('day-2', 'cash'));
      expect([late.token, early.token]).toEqual(['1', '1']);
      expect((await s.listLive()).map((o) => o.id)).toEqual([early.id]);
      expect((await s.listToday()).map((o) => o.id)).toEqual([early.id]);
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
      await s.saveItem('masala-dosa', { price: 219, soldOut: true });
      await s.saveItem('masala-dosa', { name: 'Big Masala Dosa' });
      expect((await s.getOverrides()).items['masala-dosa']).toEqual({ name: 'Big Masala Dosa', desc: null, price: 219, soldOut: true });
      vi.setSystemTime(new Date('2026-11-13T19:00:00Z')); // 00:30 IST next day
      expect((await s.getOverrides()).items['masala-dosa'].soldOut).toBe(false);
      await s.saveItem('masala-dosa', { price: null });
      expect((await s.getOverrides()).items['masala-dosa'].price).toBeNull();
      vi.useRealTimers();
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
