// In-memory store: one Node process holds today's orders. Used for local dev, demos and tests.
// (On Vercel each serverless instance has its own memory, so production must use Supabase.)
import { randomUUID } from 'node:crypto';
import { canMove, formatToken, HISTORY_MAX, isPaid, istDay, UPI_OPEN_MIN, type AdminEvent, type Order, type OrderStatus, type PlaceOrderInput } from '../orders';
import { optionKey, type Overrides } from '../menu';
import type { ItemPatch } from './index';

interface ItemRow { name: string | null; desc: string | null; price: number | null; soldOutOn: string | null }

export class StoreError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export class MemoryStore {
  readonly kind = 'memory' as const;
  private orders = new Map<string, Order>();
  private byKey = new Map<string, string>();
  private counters = new Map<string, number>();
  private items = new Map<string, ItemRow>();
  private options = new Map<string, number>();
  private events: AdminEvent[] = [];

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
    const openQr = Date.now() - UPI_OPEN_MIN * 60_000;
    return [...this.orders.values()]
      .filter((o) => o.tokenDay === day && (['awaiting_cash', 'new', 'cooking', 'ready'].includes(o.status)
        || (o.status === 'handed_over' && Date.parse(o.updatedAt) > recent)
        || (o.status === 'pending_payment' && Date.parse(o.createdAt) > openQr)))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async listToday() {
    const day = istDay();
    // reverse first so orders placed in the same millisecond still come out newest first
    return [...this.orders.values()].reverse().filter((o) => o.tokenDay === day).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, HISTORY_MAX);
  }

  async setStatus(id: string, to: OrderStatus, from?: OrderStatus) {
    const o = this.orders.get(id);
    if (!o) throw new StoreError('Order not found', 404);
    if (o.status === to) return o;
    if (from && o.status !== from) throw new StoreError(`Order ${o.token} was just changed on another screen`, 409);
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

  async listRange(fromDay: string, toDay: string) {
    return [...this.orders.values()].filter((o) => o.tokenDay >= fromDay && o.tokenDay <= toDay).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async refund(id: string, reason: string) {
    const o = this.orders.get(id);
    if (!o) throw new StoreError('Order not found', 404);
    if (o.refundedAt) throw new StoreError(`Order ${o.token} is already refunded`, 409);
    if (!isPaid(o)) throw new StoreError(`Order ${o.token} isn't paid, so there's nothing to refund. Cancel it instead.`, 409);
    const next: Order = { ...o, refundedAt: new Date().toISOString(), refundReason: reason, refundAmount: o.total, updatedAt: new Date().toISOString() };
    this.orders.set(id, next);
    return next;
  }

  async getOverrides(): Promise<Overrides> {
    const today = istDay();
    const items: Overrides['items'] = {};
    for (const [id, r] of this.items) items[id] = { name: r.name, desc: r.desc, price: r.price, soldOut: r.soldOutOn === today };
    return { items, options: Object.fromEntries(this.options) };
  }

  async saveItem(itemId: string, patch: ItemPatch) {
    const r: ItemRow = { ...(this.items.get(itemId) ?? { name: null, desc: null, price: null, soldOutOn: null }) };
    if (patch.name !== undefined) r.name = patch.name;
    if (patch.desc !== undefined) r.desc = patch.desc;
    if (patch.price !== undefined) r.price = patch.price;
    if (patch.soldOut !== undefined) r.soldOutOn = patch.soldOut ? istDay() : null;
    this.items.set(itemId, r);
  }

  async saveOptionPrice(groupId: string, optionId: string, price: number) { this.options.set(optionKey(groupId, optionId), price); }

  async addEvent(e: Omit<AdminEvent, 'at'>) { this.events.unshift({ ...e, at: new Date().toISOString() }); }

  async listEvents(limit = 100) { return this.events.slice(0, limit); }

  reset() { this.orders.clear(); this.byKey.clear(); this.counters.clear(); this.items.clear(); this.options.clear(); this.events = []; }
}
