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

  it('keeps unpaid orders out of the kitchen until paid; cash waits for the counter', async () => {
    const upi = await s.placeOrder(input('checkout-upi1'));
    const cash = await s.placeOrder(input('checkout-cash', 'cash'));
    expect(upi.status).toBe('pending_payment');
    expect(cash.status).toBe('awaiting_cash');
    expect((await s.listLive()).map((o) => o.token)).toEqual(['A-002']);
    await s.setStatus(upi.id, 'new');
    expect((await s.listLive()).map((o) => o.token)).toEqual(['A-001', 'A-002']);
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
