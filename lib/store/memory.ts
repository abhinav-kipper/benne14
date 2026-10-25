// In-memory store: one Node process holds today's orders. Used for local dev, demos and tests.
// (On Vercel each serverless instance has its own memory, so production must use Supabase.)
import { randomUUID } from 'node:crypto';
import { canMove, formatToken, istDay, type Order, type OrderStatus, type PlaceOrderInput } from '../orders';

export class StoreError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export class MemoryStore {
  readonly kind = 'memory' as const;
  private orders = new Map<string, Order>();
  private byKey = new Map<string, string>();
  private counters = new Map<string, number>();

  static shared(): MemoryStore {
    const g = globalThis as unknown as { __benneMemoryStore?: MemoryStore };
    return (g.__benneMemoryStore ??= new MemoryStore());
  }

  async placeOrder(input: PlaceOrderInput): Promise<Order> {
    const existing = this.byKey.get(input.key);
    if (existing) return this.orders.get(existing)!;
    const day = istDay();
    const n = (this.counters.get(day) ?? 0) + 1;
    this.counters.set(day, n);
    const now = new Date().toISOString();
    const order: Order = {
      ...input.priced,
      id: randomUUID(),
      token: formatToken(n),
      tokenDay: day,
      type: input.type,
      customerName: input.customerName,
      payMethod: input.payMethod,
      status: input.payMethod === 'upi' ? 'pending_payment' : 'awaiting_cash', // card and cash are paid at the counter
      createdAt: now, updatedAt: now, paidAt: null, readyAt: null,
    };
    this.orders.set(order.id, order);
    this.byKey.set(input.key, order.id);
    return order;
  }

  async getOrder(id: string) {
    return this.orders.get(id) ?? null;
  }

  async listLive() {
    const day = istDay();
    const recent = Date.now() - 10 * 60_000;
    return [...this.orders.values()]
      .filter((o) => o.tokenDay === day && (['awaiting_cash', 'new', 'cooking', 'ready'].includes(o.status) || (o.status === 'handed_over' && Date.parse(o.updatedAt) > recent)))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async setStatus(id: string, to: OrderStatus) {
    const o = this.orders.get(id);
    if (!o) throw new StoreError('Order not found', 404);
    if (o.status === to) return o;
    if (!canMove(o.status, to)) throw new StoreError(`Can't move ${o.token} from ${o.status} to ${to}`, 409);
    const now = new Date().toISOString();
    const next: Order = {
      ...o, status: to, updatedAt: now,
      paidAt: o.paidAt ?? (to === 'new' ? now : null),
      readyAt: to === 'ready' ? now : to === 'cooking' ? null : o.readyAt,
    };
    this.orders.set(id, next);
    return next;
  }

  reset() { this.orders.clear(); this.byKey.clear(); this.counters.clear(); }
}
