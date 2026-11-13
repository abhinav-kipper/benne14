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
  // Set when a payment gateway (not staff) confirmed the payment: which one, and its reference.
  payGateway?: string | null;
  payRef?: string | null;
  // The customer's phone number is deliberately not part of an order as screens see it: orders are
  // read by the TV and the phone bill. The dashboard's customer list reads it through the store.
  // Kitchen ticks: how many of each line have already been given to the customer, one count per
  // line. Missing or short = nothing given for those lines. Read it through givenOf().
  given?: number[];
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
// THE rule for takings, used by every screen and report: paid (or confirmed at the counter) and not
// refunded. Cancelled orders and unpaid UPI QRs never count; refunds are reported separately.
export const counts = (o: Pick<Order, 'status' | 'refundedAt'>) => isPaid(o) && !o.refundedAt;

// One line of an order's own history: placed, each change of state, a refund. Written by the database
// in the same transaction as the change (migration 0006), so it can't disagree with the order.
export interface OrderEvent {
  at: string;
  kind: 'placed' | 'status' | 'refund';
  from: OrderStatus | null;
  to: OrderStatus | null;
  note: string | null;
}

// A payment a gateway has confirmed with us: who, their reference, and the UPI reference if any.
export interface GatewayPayment {
  gateway: string;
  ref: string;
  bankRef?: string | null;
}

// Change history shown on the dashboard.
export interface AdminEvent {
  at: string;
  kind:
    'price' | 'name' | 'desc' | 'sold_out' | 'back_on' | 'option_price' | 'refund' | 'discount' | 'setting' | 'payment';
  subject: string;
  before?: string | null;
  after?: string | null;
  note?: string | null;
}

export interface PlaceOrderInput {
  // Idempotency key: the kiosk's checkout key plus a fingerprint of the request (checkoutKey below),
  // so the same key with a different cart is never mistaken for a retry.
  key: string;
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
    | 'payGateway'
    | 'payRef'
  > & { discountShort?: number };
}

// Which status changes staff may make from which status.
export const NEXT: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ['new', 'awaiting_cash', 'cancelled'], // awaiting_cash: customer says "I've paid", staff checks
  awaiting_cash: ['new', 'cancelled'],
  // Once paid an order can't be cancelled: the money was taken, so it can only be refunded (which is
  // recorded with a reason). Cancelling here would make it vanish from the takings without a trace.
  new: ['cooking'],
  cooking: ['ready', 'new'],
  ready: ['handed_over', 'cooking'],
  handed_over: ['ready'],
  cancelled: [],
};

// How many of each line are already given: always one whole number per line, never more than ordered.
export const givenOf = (o: Pick<Order, 'lines' | 'given'>): number[] =>
  o.lines.map((l, i) => Math.max(0, Math.min(l.qty, Math.trunc(Number(o.given?.[i]) || 0))));
export const allGiven = (o: Pick<Order, 'lines' | 'given'>) => givenOf(o).every((g, i) => g === o.lines[i].qty);
// Ticks are for orders on the kitchen rail. Why a tick is refused, or null when it is fine.
export function tickProblem(o: Order, line: number, count: number): { message: string; status: number } | null {
  if (!Number.isInteger(line) || line < 0 || line >= o.lines.length) return { message: 'No such line', status: 400 };
  if (!Number.isInteger(count) || count < 0 || count > o.lines[line].qty)
    return { message: 'That is more than was ordered', status: 400 };
  if (o.status !== 'new' && o.status !== 'cooking')
    return { message: `Order ${o.token} is no longer in the kitchen`, status: 409 };
  return null;
}

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

// Checkout keys. The kiosk sends one key per customer and reuses it for retries. The stored key is
// `<key>:<fingerprint of the request>`: a retry of the same request finds the same order, and the same
// key with a different cart or payment type is recognised as a changed order, not a retry.
export const isCheckoutKey = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(v);
export const storedKey = (key: string, fingerprint: string) => `${key}:${fingerprint}`;
