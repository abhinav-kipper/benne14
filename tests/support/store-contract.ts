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

    it('gives 30 orders placed at the same moment the numbers 1 to 30, none skipped or repeated', async () => {
      const placed = await Promise.all(Array.from({ length: 30 }, () => s.placeOrder(input())));
      expect(placed.map((o) => +o.token).sort((a, b) => a - b)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
      expect(new Set(placed.map((o) => o.id)).size).toBe(30);
      expect((await s.placeOrder(input())).token).toBe('31');
    });

    it('finds the order behind a kiosk checkout key, with the fingerprint it was placed under', async () => {
      const key = `kiosk-${Date.now()}-${n++}`;
      expect(await s.findByCheckout(key)).toBeNull();
      const a = await s.placeOrder({ ...input(), key: `${key}:aaaa1111` });
      expect(await s.findByCheckout(key)).toMatchObject({ order: { id: a.id }, fingerprint: 'aaaa1111' });
      expect(await s.findByCheckout(`${key}x`)).toBeNull(); // a longer key is a different key
      expect(await s.findByCheckout(key.slice(0, -1))).toBeNull(); // and so is a shorter one
      const old = await s.placeOrder({ ...input(), key: `${key}-old` }); // stored before fingerprints existed
      expect(await s.findByCheckout(`${key}-old`)).toMatchObject({ order: { id: old.id }, fingerprint: null });
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

    it('keeps kitchen ticks per line, only for orders in the kitchen, and a tick starts the order', async () => {
      const o = await s.placeOrder(input()); // one line: 2 × Masala Dosa
      expect(o.given ?? []).toEqual([]);
      await expect(s.setGiven(o.id, 0, 1)).rejects.toMatchObject({ status: 409 }); // not paid yet
      await s.setStatus(o.id, 'new');
      const one = await s.setGiven(o.id, 0, 1);
      expect(one.given).toEqual([1]);
      expect(one.status).toBe('cooking'); // something was given, so it is started
      expect((await s.setGiven(o.id, 0, 2)).given).toEqual([2]);
      expect((await s.setGiven(o.id, 0, 2)).given).toEqual([2]); // the same tick again changes nothing
      expect((await s.setGiven(o.id, 0, 1)).given).toEqual([1]); // one taken back
      await expect(s.setGiven(o.id, 0, 3)).rejects.toMatchObject({ status: 400 }); // more than ordered
      await expect(s.setGiven(o.id, 1, 1)).rejects.toMatchObject({ status: 400 }); // no such line
      await expect(s.setGiven(o.id, 0, -1)).rejects.toMatchObject({ status: 400 });
      expect((await s.getOrder(o.id))!.given).toEqual([1]);
      expect((await s.getOrder(o.id))!.total).toBe(o.total); // the bill is untouched
      await s.setStatus(o.id, 'ready');
      await expect(s.setGiven(o.id, 0, 2)).rejects.toMatchObject({ status: 409 }); // off the rail
      await expect(s.setGiven('00000000-0000-0000-0000-000000000000', 0, 1)).rejects.toMatchObject({ status: 404 });
    });

    it('lists live orders, the whole day, a date range and the last collected numbers', async () => {
      const unpaid = await s.placeOrder(input('upi'));
      const cooking = await s.placeOrder(input());
      const gone = await s.placeOrder(input());
      const cancelled = await s.placeOrder(input());
      await s.setStatus(cooking.id, 'new');
      await s.setStatus(cooking.id, 'cooking');
      for (const to of ['new', 'cooking', 'ready', 'handed_over'] as const) await s.setStatus(gone.id, to);
      await s.setStatus(cancelled.id, 'cancelled'); // never paid
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

    it("keeps each order's own history: placed, every change of state, the refund", async () => {
      const o = await s.placeOrder(input('upi'));
      for (const to of ['awaiting_cash', 'new', 'cooking', 'ready', 'handed_over'] as const)
        await s.setStatus(o.id, to);
      await s.setStatus(o.id, 'handed_over'); // the same status again is not a change
      await s.refund(o.id, 'Food issue');
      const log = await s.listOrderEvents(o.id);
      expect(log.map((e) => [e.kind, e.from, e.to])).toEqual([
        ['placed', null, 'pending_payment'],
        ['status', 'pending_payment', 'awaiting_cash'],
        ['status', 'awaiting_cash', 'new'],
        ['status', 'new', 'cooking'],
        ['status', 'cooking', 'ready'],
        ['status', 'ready', 'handed_over'],
        ['refund', null, null],
      ]);
      expect(log[6].note).toBe(`₹${priced.total} · Food issue`);
      expect(await s.listOrderEvents('00000000-0000-0000-0000-000000000000')).toEqual([]);
      // a paid order can't be cancelled in either store
      const paid = await s.placeOrder(input());
      await s.setStatus(paid.id, 'new');
      await expect(s.setStatus(paid.id, 'cancelled')).rejects.toMatchObject({ status: 409 });
    });

    it('a gateway payment marks the order paid once, with its reference, and never revives a cancelled order', async () => {
      const o = await s.placeOrder(input('upi'));
      const pay = { gateway: 'easebuzz', ref: 'E26TEST000001', bankRef: '053462897602' };
      const paid = await s.confirmPayment(o.id, pay);
      expect(paid).toMatchObject({ status: 'new', payGateway: 'easebuzz', payRef: 'E26TEST000001' });
      expect(paid.paidAt).toBeTruthy();
      // the same news again (webhook retry, kiosk check) changes nothing; nor does a different reference
      const again = await s.confirmPayment(o.id, pay);
      const other = await s.confirmPayment(o.id, { gateway: 'easebuzz', ref: 'E26OTHER' });
      expect([again.paidAt, again.payRef, other.payRef]).toEqual([paid.paidAt, 'E26TEST000001', 'E26TEST000001']);
      const log = await s.listOrderEvents(o.id);
      expect(log.map((e) => e.kind)).toEqual(['placed', 'status']);
      expect(log[1]).toMatchObject({ from: 'pending_payment', to: 'new' });
      expect(log[1].note).toBe('Easebuzz E26TEST000001 · UPI ref 053462897602');
      // an order staff already confirmed keeps no gateway reference it didn't get
      const byStaff = await s.placeOrder(input('upi'));
      await s.setStatus(byStaff.id, 'new');
      expect((await s.confirmPayment(byStaff.id, pay)).payRef ?? null).toBeNull();
      // cancelled stays cancelled: the caller flags the money for a refund
      const gone = await s.placeOrder(input('upi'));
      await s.setStatus(gone.id, 'cancelled');
      await expect(s.confirmPayment(gone.id, pay)).rejects.toMatchObject({ status: 409 });
      expect((await s.getOrder(gone.id))!.status).toBe('cancelled');
      await expect(s.confirmPayment('00000000-0000-0000-0000-000000000000', pay)).rejects.toMatchObject({
        status: 404,
      });
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
      expect(await s.getOverrides()).toEqual({ items: {}, options: {}, custom: [], hidden: [], order: [] });
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

    it("keeps the owner's own dishes, what is hidden and the order of the menu", async () => {
      const dish = {
        id: 'c-onion00001',
        cat: 'dosa' as const,
        name: 'Onion Benne Dosa',
        desc: 'Crisp, with onion.',
        price: 179,
        groups: ['dosaExtras'],
        photo: null,
        live: false,
      };
      await s.saveDish(dish, null); // a draft leaves no history
      expect((await s.getOverrides()).custom).toEqual([dish]);
      expect(await s.listEvents()).toEqual([]);
      await s.saveDish(
        { ...dish, price: 189, live: true },
        { kind: 'menu', subject: dish.name, after: 'Added to the menu' },
      );
      expect((await s.getOverrides()).custom).toEqual([{ ...dish, price: 189, live: true }]); // replaced, not doubled
      expect((await s.listEvents())[0]).toMatchObject({ kind: 'menu', subject: 'Onion Benne Dosa' });

      await s.saveLayout(
        { hidden: ['thatte-idli'] },
        { kind: 'menu', subject: 'Thatte Idli', after: 'Hidden from the menu' },
      );
      await s.saveLayout({ order: ['plain-dosa', dish.id, 'masala-dosa'] }, null);
      const o = await s.getOverrides();
      expect(o.hidden).toEqual(['thatte-idli']); // saving the order left the hidden list alone
      expect(o.order).toEqual(['plain-dosa', dish.id, 'masala-dosa']);
      await s.saveLayout({ hidden: [] }, null);
      expect((await s.getOverrides()).order).toEqual(['plain-dosa', dish.id, 'masala-dosa']);

      await s.deleteDish(dish.id, { kind: 'menu', subject: dish.name, after: 'Draft discarded' });
      expect((await s.getOverrides()).custom).toEqual([]);
      await expect(s.deleteDish(dish.id, { kind: 'menu', subject: 'x' })).rejects.toMatchObject({ status: 404 });
    });

    it('keeps discount codes, the kiosk switches and their history', async () => {
      expect(await s.listCodes()).toEqual([]);
      expect(await s.getSettings()).toEqual({ codes: true, phone: true });
      const code = {
        code: 'WELCOME10',
        kind: 'percent' as const,
        value: 10,
        minOrder: 200,
        maxDiscount: 50,
        expiresOn: '2030-01-31',
        active: true,
      };
      await s.saveCode(code, { kind: 'discount', subject: 'WELCOME10', after: '10% off' });
      await s.saveCode(
        { code: 'FLAT40', kind: 'flat', value: 40, minOrder: 300, maxDiscount: null, expiresOn: null, active: true },
        { kind: 'discount', subject: 'FLAT40', after: '₹40 off' },
      );
      expect(await s.getCode('WELCOME10')).toEqual(code);
      expect(await s.getCode('NOPE')).toBeNull();
      await s.saveCode({ ...code, active: false }, { kind: 'discount', subject: 'WELCOME10', after: 'off' }); // same code: replaced
      expect((await s.listCodes()).map((c) => [c.code, c.active])).toEqual([
        ['FLAT40', true],
        ['WELCOME10', false],
      ]); // newest first
      expect(
        await s.saveSettings({ phone: false }, [{ kind: 'setting', subject: 'Phone', before: 'On', after: 'Off' }]),
      ).toEqual({ codes: true, phone: false });
      expect(await s.getSettings()).toEqual({ codes: true, phone: false });
      expect((await s.listEvents()).map((e) => e.kind)).toEqual(['setting', 'discount', 'discount', 'discount']);
      // a code can be deleted for good; deleting one that isn't there says so
      await s.deleteCode('FLAT40', { kind: 'discount', subject: 'FLAT40', before: '₹40 off', after: 'Deleted' });
      expect((await s.listCodes()).map((c) => c.code)).toEqual(['WELCOME10']);
      expect(await s.getCode('FLAT40')).toBeNull();
      await expect(s.deleteCode('FLAT40', { kind: 'discount', subject: 'FLAT40' })).rejects.toMatchObject({
        status: 404,
      });
      expect((await s.listEvents())[0]).toMatchObject({ kind: 'discount', subject: 'FLAT40', after: 'Deleted' });
    });

    it('stores a discount with the order, and phone numbers only where the dashboard reads them', async () => {
      const rule = { code: 'WELCOME10', kind: 'percent' as const, value: 10, minOrder: null, maxDiscount: null };
      const withCode = priceOrder([{ itemId: 'masala-dosa', qty: 2, choices: {}, notes: [] }], undefined, rule);
      const a = await s.placeOrder({ ...input('cash', 'Asha'), priced: withCode, customerPhone: '9876543210' });
      expect(a).toMatchObject({ savings: 42, discountCode: 'WELCOME10', total: 395, subtotal: 376 });
      // the number never rides along with the order (orders are read by the TV and the phone bill)
      expect(JSON.stringify([a, await s.getOrder(a.id), await s.listToday()])).not.toContain('9876543210');
      expect(await s.listCustomers()).toEqual([]); // not paid yet
      await s.setStatus(a.id, 'new');
      const b = await s.placeOrder({ ...input('cash', 'Asha K'), customerPhone: '9876543210' });
      await s.setStatus(b.id, 'new');
      const c = await s.placeOrder({ ...input('cash', null), customerPhone: '9123456780' });
      await s.setStatus(c.id, 'new');
      await s.refund(c.id, 'Wrong order');
      await s.setStatus((await s.placeOrder(input())).id, 'new'); // no number given: not a customer row
      // (sorted here: orders placed in the same millisecond have no latest-first order to check)
      const list = (await s.listCustomers()).sort((x, y) => x.phone.localeCompare(y.phone));
      expect(list.map((x) => [x.phone, x.name, x.orders, x.spent])).toEqual([
        ['9123456780', null, 1, 0], // a refunded order counts as a visit, not as money
        ['9876543210', 'Asha K', 2, 395 + priced.total],
      ]);
      expect(list[1].firstOrderAt <= list[1].lastOrderAt).toBe(true);
    });

    it('knows which migrations have run', async () => {
      expect([...(await s.appliedMigrations())].sort()).toEqual(MIGRATIONS);
    });
  });
}
