// Order model shared by the server, the kiosk, the kitchen and the board.
import type { PricedLine } from './pricing';

export type OrderType = 'dine_in' | 'takeaway';
export type PayMethod = 'upi' | 'card' | 'cash';

// pending_payment → (paid) new → cooking → ready → handed_over
// card and cash: awaiting_cash → new (paid at the counter, staff confirms)
export type OrderStatus =
  'pending_payment' | 'awaiting_cash' | 'new' | 'cooking' | 'ready' | 'handed_over' | 'cancelled';

export interface Order {
  id: string;
  token: string; // today's order number: "42"
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
  savings: number; // discount taken off the item total (0 without a code)
  discountCode?: string | null;
  // The customer's phone number is deliberately not part of an order as screens see it: orders are
  // read by the TV and the phone bill. The dashboard's customer list reads it through the store.
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  readyAt: string | null;
  // Recorded from the owner's dashboard; the money itself goes back outside the app.
  refundedAt?: string | null;
  refundReason?: string | null;
  refundAmount?: number | null;
}

// Paid and not cancelled: the orders that count as takings (unless refunded).
export const PAID: OrderStatus[] = ['new', 'cooking', 'ready', 'handed_over'];
export const isPaid = (o: Pick<Order, 'status'>) => PAID.includes(o.status);

// Change history shown on the dashboard.
export interface AdminEvent {
  at: string;
  kind: 'price' | 'name' | 'desc' | 'sold_out' | 'back_on' | 'option_price' | 'refund' | 'discount' | 'setting';
  subject: string;
  before?: string | null;
  after?: string | null;
  note?: string | null;
}

export interface PlaceOrderInput {
  key: string; // idempotency key from the kiosk checkout
  type: OrderType;
  customerName: string | null;
  customerPhone?: string | null; // ten digits; given with the offers line shown, so it carries consent
  payMethod: PayMethod;
  priced: Omit<
    Order,
    | 'id'
    | 'token'
    | 'tokenDay'
    | 'type'
    | 'customerName'
    | 'payMethod'
    | 'status'
    | 'createdAt'
    | 'updatedAt'
    | 'paidAt'
    | 'readyAt'
    | 'refundedAt'
    | 'refundReason'
    | 'refundAmount'
  > & { discountShort?: number };
}

// Which status changes staff may make from which status.
export const NEXT: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ['new', 'awaiting_cash', 'cancelled'], // awaiting_cash: customer says "I've paid", staff checks
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

// A UPI QR the customer hasn't confirmed yet still shows on the kitchen's payment shelf for this long,
// so staff can match a soundbox announcement even if the customer forgot to tap "I've paid".
export const UPI_OPEN_MIN = 15;

// Unfinished orders stay on the kitchen and TV this long after they were placed, whatever the date:
// a shop open past midnight keeps its orders on screen, and an order nobody finished doesn't stay forever.
export const LIVE_HOURS = 6;
// How long a handed-over order stays in the live list (for undo and the "collected" moment).
export const HANDED_MIN = 10;

export function istDay(d = new Date()): string {
  return new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

export const istHour = (iso: string) => new Date(Date.parse(iso) + 5.5 * 3600_000).getUTCHours();

// Calendar maths on YYYY-MM-DD strings (no time zones involved).
export const addDays = (day: string, n: number) =>
  new Date(Date.parse(day + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86_400_000) + 1;
export const isDay = (s: unknown): s is string =>
  typeof s === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !Number.isNaN(Date.parse(s + 'T00:00:00Z')) &&
  new Date(Date.parse(s + 'T00:00:00Z')).toISOString().startsWith(s);

export const formatToken = (n: number) => String(n);

// Orders placed before plain numbers were stored as "A-042"; show them as "42" too.
export const plainToken = (t: string) => t.replace(/^[A-Z]-0*(?=\d)/, '');

export const minutesSince = (iso: string, now = Date.now()) => Math.max(0, Math.floor((now - Date.parse(iso)) / 60000));

// The name is shown on the TV and called out: keep printable characters only (no control or
// direction-override characters that could garble the board), 24 at most.
export function cleanName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  return (
    v
      .replace(/[\p{Cc}\p{Cf}]/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 24)
      .trim() || null
  );
}
