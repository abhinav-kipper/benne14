// Payment provider seam. v1 ships MockProvider; Razorpay (M6) implements the same interface.
import type { Order } from './orders';

export interface UpiRequest {
  payload: string; // what the QR encodes
  expiresInSec: number;
}

export interface PaymentProvider {
  readonly name: string;
  upiRequest(order: Pick<Order, 'token' | 'total'>): UpiRequest;
}

export const MockProvider: PaymentProvider = {
  name: 'mock',
  upiRequest: (o) => ({
    // Clearly fake payee: a real UPI app will refuse it, so no money can move.
    payload: `upi://pay?pa=demo.benne14@mockupi&pn=${encodeURIComponent('Benne 14 DEMO')}&am=${o.total.toFixed(2)}&cu=INR&tn=${encodeURIComponent(`Order ${o.token} (DEMO)`)}`,
    expiresInSec: 300,
  }),
};
