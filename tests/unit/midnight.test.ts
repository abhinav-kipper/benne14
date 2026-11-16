import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usable } from '@/lib/discounts';
import { istDay, type PlaceOrderInput } from '@/lib/orders';
import { priceOrder } from '@/lib/pricing';
import { summarize } from '@/lib/reports';
import { MemoryStore } from '@/lib/store/memory';

// One night at the shop, from 23:40 to the next morning, with the clock wound by hand. Each rule
// about the day turning over has its own test elsewhere; here they all turn over together, the way
// they do every night when nobody is watching.
const at = (ist: string) => new Date(`${ist}+05:30`);
const priced = priceOrder([{ itemId: 'masala-dosa', qty: 1, choices: {}, notes: [] }]);
const input = (key: string): PlaceOrderInput => ({
  key: `midnight-test-${key}`,
  type: 'takeaway',
  customerName: null,
  payMethod: 'cash',
  priced,
});

describe('the day turns over at midnight in India', () => {
  let s: MemoryStore;
  beforeEach(() => {
    vi.useFakeTimers();
    s = new MemoryStore();
  });
  afterEach(() => vi.useRealTimers());

  it('numbers, takings, sold out, the TV and a code all move to the new day together', async () => {
    const D1 = '2026-11-16';
    const D2 = '2026-11-17';
    const code = {
      code: 'TONIGHT',
      kind: 'percent' as const,
      value: 10,
      minOrder: 0,
      maxDiscount: null,
      expiresOn: D1,
      active: true,
    };

    // 23:40: an order that is paid, cooked and collected before midnight
    vi.setSystemTime(at(`${D1}T23:40:00`));
    expect(istDay()).toBe(D1);
    const early = await s.placeOrder(input('early'));
    for (const to of ['new', 'cooking', 'ready', 'handed_over'] as const) await s.setStatus(early.id, to);
    // the owner marks a dish sold out for the night
    await s.saveMenuEdit({ itemId: 'plain-dosa', patch: { soldOut: true }, options: [], events: [] });
    expect((await s.getOverrides()).items['plain-dosa'].soldOut).toBe(true);
    expect(usable(code, istDay())).toBe(true);

    // 23:58: an order placed and paid, still cooking when the day changes
    vi.setSystemTime(at(`${D1}T23:58:00`));
    const across = await s.placeOrder(input('across'));
    await s.setStatus(across.id, 'new');
    await s.setStatus(across.id, 'cooking');
    // 23:59: an order placed but not paid yet
    vi.setSystemTime(at(`${D1}T23:59:30`));
    const unpaid = await s.placeOrder(input('unpaid'));
    expect([early.token, across.token, unpaid.token]).toEqual(['1', '2', '3']);

    // 00:05: the new day
    vi.setSystemTime(at(`${D2}T00:05:00`));
    expect(istDay()).toBe(D2);
    const first = await s.placeOrder(input('first'));
    expect(first.token).toBe('1'); // numbers start again
    expect(first.tokenDay).toBe(D2);
    // sold out was for last night only; last night's code has stopped
    expect((await s.getOverrides()).items['plain-dosa'].soldOut).toBe(false);
    expect(usable(code, istDay())).toBe(false);

    // the kitchen still sees last night's unfinished orders, in the order they came
    expect((await s.listLive()).map((o) => o.id)).toEqual([across.id, unpaid.id, first.id]);
    // …and can finish them: the cook hands over, the counter takes the late payment
    await s.setStatus(across.id, 'ready');
    await s.setStatus(across.id, 'handed_over');
    await s.setStatus(unpaid.id, 'new');
    await s.setStatus(first.id, 'new');

    // "today" (kitchen history, TV's collected numbers) is the new day only
    expect((await s.listToday()).map((o) => o.id)).toEqual([first.id]);
    expect((await s.listCollected(8)).map((o) => o.id)).toEqual([]);

    // an order belongs to the day it was placed and numbered, whenever it was paid or collected
    const day1 = summarize(await s.listRange(D1, D1), D1, D1);
    const day2 = summarize(await s.listRange(D2, D2), D2, D2);
    expect(day1.orders).toBe(3);
    expect(day1.takings).toBe(early.total + across.total + unpaid.total);
    expect(day2.orders).toBe(1);
    expect(day2.takings).toBe(first.total);
    const both = summarize(await s.listRange(D1, D2), D1, D2);
    expect(both.days).toEqual([
      { day: D1, takings: day1.takings, orders: 3 },
      { day: D2, takings: day2.takings, orders: 1 },
    ]);
    expect(both.takings).toBe(day1.takings + day2.takings);

    // 08:00 next morning: nothing from last night is left on the kitchen screen
    vi.setSystemTime(at(`${D2}T08:00:00`));
    const morning = await s.placeOrder(input('morning'));
    expect(morning.token).toBe('2');
    const live = (await s.listLive()).map((o) => o.id);
    expect(live).not.toContain(across.id);
    expect(live).toContain(morning.id);
  });
});
