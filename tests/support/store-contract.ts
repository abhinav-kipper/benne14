// What every order store must do, whichever one is behind it. The same checks run against the
// in-memory store (always) and against the Supabase store on a real Postgres + PostgREST (in CI),
// so the two can't drift apart. Nothing here depends on the clock.
import { beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS } from '@/lib/migrations';
import type { PlaceOrderInput } from '@/lib/orders';
import { priceOrder } from '@/lib/pricing';
import type { Store } from '@/lib/store';

const priced = priceOrder([{ itemId: 'masala-dosa', qty: 2, choices: { dosaExtras: ['benne'] }, notes: ['less-oil'] }]);
let n = 0;
const input = (payMethod: PlaceOrderInput['payMethod'] = 'cash', name: string | null = 'Rahul'): PlaceOrderInput => ({
  key: `contract-${Date.now()}-${n++}`,
  type: 'takeaway',
  customerName: name,
  payMethod,
  priced,
});

export function storeContract(name: string, fresh: () => Promise<Store>) {
  describe(`store contract: ${name}`, () => {
    let s: Store;
    beforeEach(async () => {
      s = await fresh();
    });

    it('places an order once per checkout key, with numbers 1, 2, 3…', async () => {
      const first = input();
      const a = await s.placeOrder(first);
      const again = await s.placeOrder(first);
      const b = await s.placeOrder(input('upi', null));
      expect(again.id).toBe(a.id);
      expect([a.token, b.token]).toEqual(['1', '2']);
      expect(a).toMatchObject({
        status: 'awaiting_cash',
        customerName: 'Rahul',
        total: priced.total,
        subtotal: priced.subtotal,
      });
      expect(b).toMatchObject({ status: 'pending_payment', customerName: null });
      expect(a.lines).toEqual(priced.lines);
      expect((await s.getOrder(a.id))!.id).toBe(a.id);
      expect(await s.getOrder('00000000-0000-0000-0000-000000000000')).toBeNull();
    });

    it('moves an order through the kitchen and refuses impossible or stale moves', async () => {
      const o = await s.placeOrder(input());
      await expect(s.setStatus(o.id, 'ready')).rejects.toMatchObject({ status: 409 });
      const paid = await s.setStatus(o.id, 'new', 'awaiting_cash');
      expect(paid.paidAt).not.toBeNull();
      await s.setStatus(o.id, 'cooking');
      const ready = await s.setStatus(o.id, 'ready');
      expect(ready.readyAt).not.toBeNull();
      await expect(s.setStatus(o.id, 'cooking', 'new')).rejects.toMatchObject({ status: 409 }); // a tablet that hadn't refreshed
      expect((await s.setStatus(o.id, 'ready')).status).toBe('ready'); // same status twice is harmless
      expect((await s.setStatus(o.id, 'handed_over', 'ready')).status).toBe('handed_over');
      await expect(s.setStatus('00000000-0000-0000-0000-000000000000', 'new')).rejects.toMatchObject({ status: 404 });
    });

    it('lists live orders, the whole day, a date range and the last collected numbers', async () => {
      const unpaid = await s.placeOrder(input('upi'));
      const cooking = await s.placeOrder(input());
      const gone = await s.placeOrder(input());
      const cancelled = await s.placeOrder(input());
      await s.setStatus(cooking.id, 'new');
      await s.setStatus(cooking.id, 'cooking');
      for (const to of ['new', 'cooking', 'ready', 'handed_over'] as const) await s.setStatus(gone.id, to);
      await s.setStatus(cancelled.id, 'cancelled');
      const live = (await s.listLive()).map((o) => o.id);
      expect(live).toEqual([unpaid.id, cooking.id, gone.id]); // oldest first; cancelled is gone, just-collected stays a while
      expect((await s.listToday()).map((o) => o.id)).toEqual([cancelled.id, gone.id, cooking.id, unpaid.id]); // newest first
      expect((await s.listRange(unpaid.tokenDay, unpaid.tokenDay)).map((o) => o.id)).toEqual([
        unpaid.id,
        cooking.id,
        gone.id,
        cancelled.id,
      ]);
      expect(await s.listRange('2000-01-01', '2000-01-02')).toEqual([]);
      expect(await s.listCollected(8)).toEqual([{ id: gone.id, token: gone.token }]);
    });

    it('records a refund once, for paid orders only', async () => {
      const unpaid = await s.placeOrder(input());
      await expect(s.refund(unpaid.id, 'x')).rejects.toMatchObject({ status: 409 });
      await s.setStatus(unpaid.id, 'new');
      const r = await s.refund(unpaid.id, 'Wrong order');
      expect(r).toMatchObject({ refundReason: 'Wrong order', refundAmount: priced.total });
      expect(r.refundedAt).toBeTruthy();
      await expect(s.refund(unpaid.id, 'again')).rejects.toMatchObject({ status: 409 });
      expect((await s.getOrder(unpaid.id))!.refundReason).toBe('Wrong order');
    });

    it("keeps the owner's menu edits, extras and history together", async () => {
      expect(await s.getOverrides()).toEqual({ items: {}, options: {} });
      await s.saveMenuEdit({
        itemId: 'masala-dosa',
        patch: { price: 219, name: 'Big Masala Dosa', soldOut: true },
        options: [{ groupId: 'dosaExtras', optionId: 'benne', price: 30 }],
        events: [{ kind: 'price', subject: 'Big Masala Dosa', before: '₹209', after: '₹219' }],
      });
      await s.saveMenuEdit({ itemId: 'masala-dosa', patch: { desc: 'Crisp.' }, options: [], events: [] }); // other fields untouched
      let o = await s.getOverrides();
      expect(o.items['masala-dosa']).toEqual({ name: 'Big Masala Dosa', desc: 'Crisp.', price: 219, soldOut: true });
      expect(o.options).toEqual({ 'dosaExtras:benne': 30 });
      await s.saveMenuEdit({ itemId: 'masala-dosa', patch: { name: null, soldOut: false }, options: [], events: [] }); // null = back to the menu in code
      o = await s.getOverrides();
      expect(o.items['masala-dosa']).toEqual({ name: null, desc: 'Crisp.', price: 219, soldOut: false });
      await s.addEvent({ kind: 'refund', subject: 'Order 7', after: '₹219', note: 'Wrong order' });
      const events = await s.listEvents();
      expect(events.map((e) => e.kind)).toEqual(['refund', 'price']); // newest first
      expect(events[1]).toMatchObject({ subject: 'Big Masala Dosa', before: '₹209', after: '₹219' });
    });

    it('knows which migrations have run', async () => {
      expect([...(await s.appliedMigrations())].sort()).toEqual(MIGRATIONS);
    });
  });
}
