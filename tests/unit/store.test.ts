import { beforeEach, describe, expect, it } from 'vitest';
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
    expect(a.token).toBe('A-001');
    expect(again.id).toBe(a.id);
    expect(b.token).toBe('A-002');
  });

  it('keeps unpaid orders off the cooking rail; they wait on the payment shelf', async () => {
    const upi = await s.placeOrder(input('checkout-upi1'));
    const cash = await s.placeOrder(input('checkout-cash', 'cash'));
    expect(upi.status).toBe('pending_payment');
    expect(cash.status).toBe('awaiting_cash');
    const rail = async () => (await s.listLive()).filter((o) => o.status === 'new' || o.status === 'cooking').map((o) => o.token);
    expect((await s.listLive()).map((o) => `${o.token}:${o.status}`)).toEqual(['A-001:pending_payment', 'A-002:awaiting_cash']);
    expect(await rail()).toEqual([]);
    await s.setStatus(upi.id, 'awaiting_cash'); // customer: "I've paid"
    await s.setStatus(upi.id, 'new'); // counter: soundbox confirmed
    expect(await rail()).toEqual(['A-001']);
  });

  it('drops an abandoned UPI QR from the shelf when cancelled', async () => {
    const upi = await s.placeOrder(input('checkout-upi2'));
    await s.setStatus(upi.id, 'cancelled');
    expect(await s.listLive()).toEqual([]);
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
});
