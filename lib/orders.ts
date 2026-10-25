// Order model shared by the server, the kiosk, the kitchen and the board.
import type { PricedLine } from './pricing';

export type OrderType = 'dine_in' | 'takeaway';
export type PayMethod = 'upi' | 'card' | 'cash';

// pending_payment → (paid) new → cooking → ready → handed_over
// card and cash: awaiting_cash → new (paid at the counter, staff confirms)
export type OrderStatus = 'pending_payment' | 'awaiting_cash' | 'new' | 'cooking' | 'ready' | 'handed_over' | 'cancelled';

export interface Order {
  id: string;
  token: string; // A-042
  tokenDay: string; // YYYY-MM-DD in IST
  type: OrderType;
  customerName: string | null;
  payMethod: PayMethod;
  status: OrderStatus;
  lines: PricedLine[];
  itemCount: number;
  subtotal: number;
  cgst: number;
  sgst: number;
  roundOff: number;
  total: number;
  savings: number;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  readyAt: string | null;
}

export interface PlaceOrderInput {
  key: string; // idempotency key from the kiosk checkout
  type: OrderType;
  customerName: string | null;
  payMethod: PayMethod;
  priced: Omit<Order, 'id' | 'token' | 'tokenDay' | 'type' | 'customerName' | 'payMethod' | 'status' | 'createdAt' | 'updatedAt' | 'paidAt' | 'readyAt'>;
}

// Which status changes staff may make from which status.
export const NEXT: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ['new', 'cancelled'],
  awaiting_cash: ['new', 'cancelled'],
  new: ['cooking', 'cancelled'],
  cooking: ['ready', 'new'],
  ready: ['handed_over', 'cooking'],
  handed_over: ['ready'],
  cancelled: [],
};

export const canMove = (from: OrderStatus, to: OrderStatus) => NEXT[from].includes(to);

// Orders the kitchen and the board care about.
export const LIVE: OrderStatus[] = ['awaiting_cash', 'new', 'cooking', 'ready'];

export function istDay(d = new Date()): string {
  return new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

export const formatToken = (n: number) => `A-${String(n).padStart(3, '0')}`;

export const minutesSince = (iso: string, now = Date.now()) => Math.max(0, Math.floor((now - Date.parse(iso)) / 60000));
