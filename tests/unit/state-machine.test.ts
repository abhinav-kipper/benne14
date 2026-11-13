import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryStore, StoreError } from '@/lib/store/memory';
import { canMove, NEXT, type OrderStatus } from '@/lib/orders';
import { priceOrder } from '@/lib/pricing';

// Every (from → to) pair, so a change to NEXT or to setStatus can't quietly open or close a move.
const ALL: OrderStatus[] = ['pending_payment', 'awaiting_cash', 'new', 'cooking', 'ready', 'handed_over', 'cancelled'];
const priced = priceOrder([{ itemId: 'masala-dosa', qty: 1, choices: {}, notes: [] }]);

// Shortest way to reach each status from a fresh UPI order.
const PATH: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: [],
  awaiting_cash: ['awaiting_cash'],
  new: ['new'],
  cooking: ['new', 'cooking'],
  ready: ['new', 'cooking', 'ready'],
  handed_over: ['new', 'cooking', 'ready', 'handed_over'],
  cancelled: ['cancelled'],
};

describe('order status machine', () => {
  let s: MemoryStore;
  let n = 0;
  beforeEach(() => { s = new MemoryStore(); });
  const at = async (status: OrderStatus) => {
    const o = await s.placeOrder({ key: `sm-${n++}-key`, type: 'takeaway', customerName: null, payMethod: 'upi', priced });
    for (const to of PATH[status]) await s.setStatus(o.id, to);
    return o.id;
  };

  for (const from of ALL) for (const to of ALL) {
    if (from === to) continue;
    const ok = canMove(from, to);
    it(`${from} → ${to}: ${ok ? 'allowed' : 'refused'}`, async () => {
      const id = await at(from);
      if (ok) expect((await s.setStatus(id, to)).status).toBe(to);
      else await expect(s.setStatus(id, to)).rejects.toMatchObject({ status: 409 });
    });
  }

  it('cancelled is final and nothing leads back to unpaid', () => {
    expect(NEXT.cancelled).toEqual([]);
    for (const from of ALL) expect(NEXT[from]).not.toContain('pending_payment');
  });

  it('setting the same status twice is a no-op (a double tap is harmless)', async () => {
    const id = await at('cooking');
    const a = await s.setStatus(id, 'cooking');
    expect(a.status).toBe('cooking');
  });

  it('refuses a stale tablet: "from" must match the current status', async () => {
    const id = await at('ready'); // tablet A marked it ready
    // tablet B still shows it as new and taps Start: would undo A's ready without the check
    await expect(s.setStatus(id, 'cooking', 'new')).rejects.toBeInstanceOf(StoreError);
    expect((await s.getOrder(id))!.status).toBe('ready');
    expect((await s.setStatus(id, 'handed_over', 'ready')).status).toBe('handed_over');
  });

  it('stamps paidAt once and readyAt only while ready', async () => {
    const id = await at('new');
    const paid = (await s.getOrder(id))!.paidAt;
    expect(paid).not.toBeNull();
    await s.setStatus(id, 'cooking');
    const r = await s.setStatus(id, 'ready');
    expect(r.readyAt).not.toBeNull();
    expect(r.paidAt).toBe(paid);
    expect((await s.setStatus(id, 'cooking')).readyAt).toBeNull();
  });
});
