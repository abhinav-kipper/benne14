import { describe, expect, it } from 'vitest';
import { DirectUpiProvider, MockProvider, upiLink } from '@/lib/payments';
import { canMove } from '@/lib/orders';
import { SHOP } from '@/lib/shop';

const params = (link: string) => Object.fromEntries(new URL(link.replace('upi://pay', 'https://x/pay')).searchParams);

describe('UPI links', () => {
  it('pays the shop by name with the exact amount and the token in the note', () => {
    const p = params(DirectUpiProvider.upiRequest({ token: 'A-042', total: 330 }).payload);
    expect(p).toEqual({ pa: 'paytm.s3zpul3@pty', pn: 'Benne 14', am: '330.00', cu: 'INR', tn: 'Benne 14 A-042' });
    expect(SHOP.name).toBe('Benne 14');
  });

  it('writes the UPI ID like Paytm does (plain @) and spaces as %20', () => {
    expect(upiLink({ upiId: 'paytm.s3zpul3@pty', name: 'Benne 14', amount: 62, note: 'x y' }))
      .toBe('upi://pay?pa=paytm.s3zpul3@pty&pn=Benne%2014&am=62.00&cu=INR&tn=x%20y');
  });

  it('keeps the mock pointed at a payee no real app will pay', () => {
    expect(params(MockProvider.upiRequest({ token: 'A-001', total: 76 }).payload).pa).toBe('demo.benne14@mockupi');
  });

  it("lets a customer's \"I've paid\" move the order to the counter check", () => {
    expect(canMove('pending_payment', 'awaiting_cash')).toBe(true);
    expect(canMove('awaiting_cash', 'new')).toBe(true);
    expect(canMove('awaiting_cash', 'pending_payment')).toBe(false);
  });
});
