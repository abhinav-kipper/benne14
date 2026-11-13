import { describe, expect, it } from 'vitest';
import { billsCsv, dishesCsv, gstCsv, previousPeriod, summarize } from '@/lib/reports';
import { priceOrder } from '@/lib/pricing';
import type { Order, OrderStatus, PayMethod } from '@/lib/orders';

let n = 0;
function order(
  day: string,
  hhmm: string,
  status: OrderStatus,
  pay: PayMethod,
  cart: Parameters<typeof priceOrder>[0],
  extra: Partial<Order> = {},
): Order {
  const p = priceOrder(cart);
  const createdAt = new Date(Date.parse(`${day}T${hhmm}:00+05:30`)).toISOString();
  return {
    ...p,
    id: `o${n}`,
    token: String(++n),
    tokenDay: day,
    type: 'takeaway',
    customerName: null,
    payMethod: pay,
    status,
    createdAt,
    updatedAt: createdAt,
    paidAt: null,
    readyAt: null,
    ...extra,
  };
}
const dosa = [{ itemId: 'masala-dosa', qty: 2, choices: { dosaExtras: ['benne'] }, notes: [] }]; // 2 × (209 + 25) = 468, GST 23 (11.50 + 11.50) → 491
const tea = [{ itemId: 'masala-tea', qty: 1, choices: {}, notes: [] }]; // 49 + 2 → 51

describe('owner reports', () => {
  const day = '2026-11-13';
  const orders = [
    order(day, '08:30', 'handed_over', 'upi', dosa),
    order(day, '08:45', 'cooking', 'cash', tea),
    order(day, '09:10', 'ready', 'card', tea),
    order(day, '09:20', 'handed_over', 'upi', tea, {
      refundedAt: '2026-11-13T04:00:00Z',
      refundReason: 'Wrong order',
      refundAmount: 51,
    }),
    order(day, '09:30', 'cancelled', 'upi', dosa), // never paid
    order(day, '09:40', 'pending_payment', 'upi', dosa), // QR still open
    order(day, '09:50', 'awaiting_cash', 'cash', dosa), // not confirmed yet
    order(day, '23:30', 'new', 'cash', tea), // after the usual hours
  ];
  const s = summarize(orders, day, day);

  it('counts paid orders only; refunds come off and are shown on their own', () => {
    expect(s.orders).toBe(4);
    expect(s.takings).toBe(491 + 51 + 51 + 51);
    expect(s.refunds).toEqual({ count: 1, amount: 51 });
    expect(s.avgBill).toBe(Math.round(644 / 4));
  });

  it('splits takings by payment type', () => {
    expect(s.split).toEqual({ upi: 491, card: 51, cash: 102 });
  });

  it('dish amounts exclude extras, which have their own line', () => {
    expect(s.dishes[0]).toMatchObject({ itemId: 'masala-tea', qty: 3, amount: 147 });
    expect(s.dishes[1]).toMatchObject({ itemId: 'masala-dosa', qty: 2, amount: 418 });
    expect(s.extras).toEqual({ qty: 2, amount: 50 });
    expect(s.dishes.reduce((a, d) => a + d.amount, 0) + s.extras.amount).toBe(s.gst.taxable);
  });

  it('GST adds up to the takings', () => {
    expect(s.gst.taxable + s.gst.cgst + s.gst.sgst).toBe(s.gst.total);
    expect(s.gst.total).toBe(s.takings);
  });

  it('busy hours cover the shop day and stretch to late orders', () => {
    expect(s.hours[0].hour).toBe(8);
    expect(s.hours.at(-1)!.hour).toBe(23);
    expect(s.hours.find((h) => h.hour === 8)!.orders).toBe(2);
    expect(s.hours.find((h) => h.hour === 9)!.orders).toBe(1);
  });

  it('lists every day in a range, empty days too', () => {
    const w = summarize(orders, '2026-11-07', day);
    expect(w.days.map((d) => d.day)).toEqual([
      '2026-11-07',
      '2026-11-08',
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
    ]);
    expect(w.days.at(-1)!.takings).toBe(644);
    expect(w.days[0]).toEqual({ day: '2026-11-07', takings: 0, orders: 0 });
  });

  it('compares with the period just before, of the same length', () => {
    expect(previousPeriod(day, day)).toEqual({ from: '2026-11-12', to: '2026-11-12' }); // yesterday
    expect(previousPeriod('2026-11-07', day)).toEqual({ from: '2026-10-31', to: '2026-11-06' });
    expect(previousPeriod('2026-03-01', '2026-03-31')).toEqual({ from: '2026-01-29', to: '2026-02-28' });
  });

  it('is empty, not broken, for a day with no orders', () => {
    const e = summarize([], day, day);
    expect(e).toMatchObject({ takings: 0, orders: 0, avgBill: 0, refunds: { count: 0, amount: 0 } });
  });

  it('CSV for the CA: paid bills (refunds marked), GST per day, dishes', () => {
    const bills = billsCsv(orders).trim().split('\r\n');
    expect(bills).toHaveLength(1 + 5); // header + 4 counted + 1 refunded
    expect(bills.find((l) => l.includes('Wrong order'))).toContain('51.00');
    const gst = gstCsv(orders, day, day).trim().split('\r\n');
    expect(gst[1]).toBe(`${day},4,615.00,14.50,14.50,644.00`);
    expect(dishesCsv(orders, day, day)).toContain('Extras,2,50.00');
  });

  it('CSV cells are quoted, and names cannot become spreadsheet formulas', () => {
    const evil = order(day, '10:00', 'handed_over', 'cash', tea, {
      refundedAt: 'x',
      refundReason: '=HYPERLINK("http://x","click"), "quoted"',
    });
    const row = billsCsv([evil]).trim().split('\r\n')[1];
    expect(row).toContain(`"'=HYPERLINK(""http://x"",""click""), ""quoted"""`);
  });
});
