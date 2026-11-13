// In-memory store: one Node process holds today's orders. Used for local dev, demos and tests.
// (On Vercel each serverless instance has its own memory, so production must use Supabase.)
import { randomUUID } from 'node:crypto';
import {
  canMove,
  formatToken,
  HANDED_MIN,
  isPaid,
  istDay,
  LIVE,
  LIVE_HOURS,
  UPI_OPEN_MIN,
  type AdminEvent,
  type Order,
  type OrderStatus,
  type PlaceOrderInput,
} from '../orders';
import { DEFAULT_SETTINGS, type Customer, type DiscountCode, type KioskSettings } from '../discounts';
import { optionKey, type Overrides } from '../menu';
import type { MenuEdit } from './index';
import { MIGRATIONS } from '../migrations';

interface ItemRow {
  name: string | null;
  desc: string | null;
  price: number | null;
  soldOutOn: string | null;
}

export class StoreError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export class MemoryStore {
  readonly kind = 'memory' as const;
  private orders = new Map<string, Order>();
  private byKey = new Map<string, string>();
  private counters = new Map<string, number>();
  private items = new Map<string, ItemRow>();
  private options = new Map<string, number>();
  private events: AdminEvent[] = [];
  private phones = new Map<string, string>(); // order id -> phone; kept out of the order itself
  private codes = new Map<string, DiscountCode & { createdAt: number }>();
  private settings: KioskSettings = { ...DEFAULT_SETTINGS };

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
    const { discountShort: _short, ...priced } = input.priced;
    const order: Order = {
      ...priced,
      discountCode: priced.discountCode ?? null,
      id: randomUUID(),
      token: formatToken(n),
      tokenDay: day,
      type: input.type,
      customerName: input.customerName,
      payMethod: input.payMethod,
      status: input.payMethod === 'upi' ? 'pending_payment' : 'awaiting_cash', // card and cash are paid at the counter
      createdAt: now,
      updatedAt: now,
      paidAt: null,
      readyAt: null,
    };
    this.orders.set(order.id, order);
    this.byKey.set(input.key, order.id);
    if (input.customerPhone) this.phones.set(order.id, input.customerPhone);
    return order;
  }

  async getOrder(id: string) {
    return this.orders.get(id) ?? null;
  }

  async listLive() {
    const since = Date.now() - LIVE_HOURS * 3600_000;
    const recent = Date.now() - HANDED_MIN * 60_000;
    const openQr = Date.now() - UPI_OPEN_MIN * 60_000;
    return [...this.orders.values()]
      .filter(
        (o) =>
          (LIVE.includes(o.status) && Date.parse(o.createdAt) > since) ||
          (o.status === 'handed_over' && Date.parse(o.updatedAt) > recent) ||
          (o.status === 'pending_payment' && Date.parse(o.createdAt) > openQr),
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async listToday() {
    const day = istDay();
    // reverse first so orders placed in the same millisecond still come out newest first
    return [...this.orders.values()]
      .reverse()
      .filter((o) => o.tokenDay === day)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listCollected(limit: number) {
    const day = istDay();
    return [...this.orders.values()]
      .filter((o) => o.tokenDay === day && o.status === 'handed_over')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map((o) => ({ id: o.id, token: o.token }));
  }

  async setStatus(id: string, to: OrderStatus, from?: OrderStatus) {
    const o = this.orders.get(id);
    if (!o) throw new StoreError('Order not found', 404);
    if (o.status === to) return o;
    if (from && o.status !== from) throw new StoreError(`Order ${o.token} was just changed on another screen`, 409);
    if (!canMove(o.status, to)) throw new StoreError(`Can't move ${o.token} from ${o.status} to ${to}`, 409);
    const now = new Date().toISOString();
    const next: Order = {
      ...o,
      status: to,
      updatedAt: now,
      paidAt: o.paidAt ?? (to === 'new' ? now : null),
      readyAt: to === 'ready' ? now : to === 'cooking' ? null : o.readyAt,
    };
    this.orders.set(id, next);
    return next;
  }

  async listRange(fromDay: string, toDay: string) {
    return [...this.orders.values()]
      .filter((o) => o.tokenDay >= fromDay && o.tokenDay <= toDay)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async refund(id: string, reason: string) {
    const o = this.orders.get(id);
    if (!o) throw new StoreError('Order not found', 404);
    if (o.refundedAt) throw new StoreError(`Order ${o.token} is already refunded`, 409);
    if (!isPaid(o))
      throw new StoreError(`Order ${o.token} isn't paid, so there's nothing to refund. Cancel it instead.`, 409);
    const next: Order = {
      ...o,
      refundedAt: new Date().toISOString(),
      refundReason: reason,
      refundAmount: o.total,
      updatedAt: new Date().toISOString(),
    };
    this.orders.set(id, next);
    return next;
  }

  async getOverrides(): Promise<Overrides> {
    const today = istDay();
    const items: Overrides['items'] = {};
    for (const [id, r] of this.items)
      items[id] = { name: r.name, desc: r.desc, price: r.price, soldOut: r.soldOutOn === today };
    return { items, options: Object.fromEntries(this.options) };
  }

  async saveMenuEdit(e: MenuEdit) {
    const r: ItemRow = { ...(this.items.get(e.itemId) ?? { name: null, desc: null, price: null, soldOutOn: null }) };
    if (e.patch.name !== undefined) r.name = e.patch.name;
    if (e.patch.desc !== undefined) r.desc = e.patch.desc;
    if (e.patch.price !== undefined) r.price = e.patch.price;
    if (e.patch.soldOut !== undefined) r.soldOutOn = e.patch.soldOut ? istDay() : null;
    this.items.set(e.itemId, r);
    for (const o of e.options) this.options.set(optionKey(o.groupId, o.optionId), o.price);
    for (const ev of e.events) await this.addEvent(ev);
  }

  async addEvent(e: Omit<AdminEvent, 'at'>) {
    this.events.unshift({ ...e, at: new Date().toISOString() });
  }

  async listEvents(limit = 100) {
    return this.events.slice(0, limit);
  }

  async listCodes() {
    return [...this.codes.values()].sort((a, b) => b.createdAt - a.createdAt).map(({ createdAt: _c, ...c }) => c);
  }

  async getCode(code: string) {
    const c = this.codes.get(code);
    if (!c) return null;
    const { createdAt: _c, ...rest } = c;
    return rest;
  }

  async saveCode(c: DiscountCode, event: Omit<AdminEvent, 'at'>) {
    this.codes.set(c.code, { ...c, createdAt: this.codes.get(c.code)?.createdAt ?? Date.now() + this.codes.size });
    await this.addEvent(event);
  }

  async getSettings() {
    return { ...this.settings };
  }

  async saveSettings(patch: Partial<KioskSettings>, events: Omit<AdminEvent, 'at'>[]) {
    this.settings = { ...this.settings, ...patch };
    for (const e of events) await this.addEvent(e);
    return { ...this.settings };
  }

  async listCustomers(): Promise<Customer[]> {
    const by = new Map<string, Customer>();
    const paid = [...this.orders.values()]
      .filter((o) => isPaid(o) && this.phones.has(o.id))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const o of paid) {
      const phone = this.phones.get(o.id)!;
      const c = by.get(phone) ?? {
        phone,
        name: null,
        orders: 0,
        spent: 0,
        firstOrderAt: o.createdAt,
        lastOrderAt: o.createdAt,
      };
      c.orders += 1;
      c.spent += o.refundedAt ? 0 : o.total;
      c.name = o.customerName ?? c.name;
      c.lastOrderAt = o.createdAt;
      by.set(phone, c);
    }
    return [...by.values()].sort((a, b) => b.lastOrderAt.localeCompare(a.lastOrderAt));
  }

  async appliedMigrations() {
    return MIGRATIONS;
  } // nothing to migrate in memory

  reset() {
    this.orders.clear();
    this.byKey.clear();
    this.counters.clear();
    this.items.clear();
    this.options.clear();
    this.events = [];
    this.phones.clear();
    this.codes.clear();
    this.settings = { ...DEFAULT_SETTINGS };
  }
}
