// Payment provider seam. Today: direct UPI to the shop's own UPI ID (staff confirm on the soundbox),
// or a mock for tests. A gateway with automatic confirmation (Paytm API) implements the same interface.
import type { Order } from './orders';
import { SHOP } from './shop';

export interface UpiRequest {
  payload: string; // what the QR encodes
  expiresInSec: number;
}

export interface PaymentProvider {
  readonly name: string;
  readonly autoConfirms: boolean; // true once a gateway tells us about payments; false = staff confirm
  upiRequest(order: Pick<Order, 'token' | 'total'>): UpiRequest;
}

// Standard UPI deep link (NPCI). Only the widely supported fields: payee, name, fixed amount, currency, note.
export function upiLink(p: { upiId: string; name: string; amount: number; note: string }): string {
  // Encode values, but keep "@" in the UPI ID literal: it's how Paytm's own QR writes it and some apps
  // don't decode %40 in the payee.
  const enc = (v: string) => encodeURIComponent(v).replace(/%40/g, '@');
  return `upi://pay?pa=${enc(p.upiId)}&pn=${enc(p.name)}&am=${p.amount.toFixed(2)}&cu=INR&tn=${enc(p.note)}`;
}

export const DirectUpiProvider: PaymentProvider = {
  name: 'upi-direct',
  autoConfirms: false,
  upiRequest: (o) => ({ payload: upiLink({ upiId: SHOP.upiId, name: SHOP.name, amount: o.total, note: `${SHOP.name} ${o.token}` }), expiresInSec: 300 }),
};

export const MockProvider: PaymentProvider = {
  name: 'mock',
  autoConfirms: false,
  // Clearly fake payee: a real UPI app will refuse it, so no money can move.
  upiRequest: (o) => ({ payload: upiLink({ upiId: 'demo.benne14@mockupi', name: 'Benne 14 DEMO', amount: o.total, note: `Order ${o.token} (DEMO)` }), expiresInSec: 300 }),
};
