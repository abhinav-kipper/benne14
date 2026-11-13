// Supabase-backed store. Server only: uses the service role key; tables have RLS with no public policies.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { optionKey, type Overrides } from '../menu';
import type { ItemPatch } from './index';
import { canMove, HISTORY_MAX, isPaid, istDay, LIVE, plainToken, UPI_OPEN_MIN, type AdminEvent, type Order, type OrderStatus, type PlaceOrderInput } from '../orders';
import { StoreError } from './memory';

interface Row {
  id: string; token: string; token_day: string; type: Order['type']; customer_name: string | null;
  pay_method: Order['payMethod']; status: OrderStatus; lines: Order['lines']; item_count: number;
  subtotal: string | number; cgst: string | number; sgst: string | number; round_off: string | number;
  total: string | number; savings: string | number;
  created_at: string; updated_at: string; paid_at: string | null; ready_at: string | null;
  refunded_at?: string | null; refund_reason?: string | null; refund_amount?: string | number | null;
}

const toOrder = (r: Row): Order => ({
  id: r.id, token: plainToken(r.token), tokenDay: r.token_day, type: r.type, customerName: r.customer_name,
  payMethod: r.pay_method, status: r.status, lines: r.lines, itemCount: r.item_count,
  subtotal: +r.subtotal, cgst: +r.cgst, sgst: +r.sgst, roundOff: +r.round_off, total: +r.total, savings: +r.savings,
  createdAt: r.created_at, updatedAt: r.updated_at, paidAt: r.paid_at, readyAt: r.ready_at,
  refundedAt: r.refunded_at ?? null, refundReason: r.refund_reason ?? null, refundAmount: r.refund_amount == null ? null : +r.refund_amount,
});

export class SupabaseStore {
  readonly kind = 'supabase' as const;
  private db: SupabaseClient;

  constructor(url: string, serviceKey: string) {
    this.db = createClient(url, serviceKey, { auth: { persistSession: false } });
  }

  async placeOrder(input: PlaceOrderInput): Promise<Order> {
    const { data, error } = await this.db.rpc('place_order', {
      p_key: input.key, p_type: input.type, p_name: input.customerName ?? '', p_pay: input.payMethod, p_priced: input.priced,
    });
    if (error) throw new StoreError(error.message, 500);
    return toOrder(data as Row);
  }

  async getOrder(id: string) {
    const { data, error } = await this.db.from('orders').select('*').eq('id', id).maybeSingle();
    if (error) throw new StoreError(error.message, 500);
    return data ? toOrder(data as Row) : null;
  }

  async listLive() {
    const since = new Date(Date.now() - 10 * 60_000).toISOString();
    const openQr = new Date(Date.now() - UPI_OPEN_MIN * 60_000).toISOString();
    const { data, error } = await this.db.from('orders').select('*')
      .eq('token_day', istDay())
      .or(`status.in.(${LIVE.join(',')}),and(status.eq.handed_over,updated_at.gt.${since}),and(status.eq.pending_payment,created_at.gt.${openQr})`)
      .order('created_at');
    if (error) throw new StoreError(error.message, 500);
    return (data as Row[]).map(toOrder);
  }

  async listToday() {
    const { data, error } = await this.db.from('orders').select('*').eq('token_day', istDay()).order('created_at', { ascending: false }).limit(HISTORY_MAX);
    if (error) throw new StoreError(error.message, 500);
    return (data as Row[]).map(toOrder);
  }

  async setStatus(id: string, to: OrderStatus, from?: OrderStatus) {
    const cur = await this.getOrder(id);
    if (!cur) throw new StoreError('Order not found', 404);
    if (cur.status === to) return cur;
    if (from && cur.status !== from) throw new StoreError(`Order ${cur.token} was just changed on another screen`, 409);
    if (!canMove(cur.status, to)) throw new StoreError(`Can't move ${cur.token} from ${cur.status} to ${to}`, 409);
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { status: to, updated_at: now };
    if (to === 'new' && !cur.paidAt) patch.paid_at = now;
    if (to === 'ready') patch.ready_at = now;
    if (to === 'cooking') patch.ready_at = null;
    // Conditional on the status we read, so two taps on two tablets can't both win.
    const { data, error } = await this.db.from('orders').update(patch).eq('id', id).eq('status', cur.status).select('*').maybeSingle();
    if (error) throw new StoreError(error.message, 500);
    if (!data) throw new StoreError(`Order ${cur.token} was just changed on another screen`, 409);
    return toOrder(data as Row);
  }

  async listRange(fromDay: string, toDay: string) {
    // Supabase returns at most 1000 rows per request: page through a long range.
    const out: Order[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await this.db.from('orders').select('*').gte('token_day', fromDay).lte('token_day', toDay)
        .order('created_at').order('id').range(from, from + 999);
      if (error) throw new StoreError(error.message, 500);
      out.push(...(data as Row[]).map(toOrder));
      if (data.length < 1000) return out;
    }
  }

  async refund(id: string, reason: string) {
    const cur = await this.getOrder(id);
    if (!cur) throw new StoreError('Order not found', 404);
    if (cur.refundedAt) throw new StoreError(`Order ${cur.token} is already refunded`, 409);
    if (!isPaid(cur)) throw new StoreError(`Order ${cur.token} isn't paid, so there's nothing to refund. Cancel it instead.`, 409);
    const now = new Date().toISOString();
    const { data, error } = await this.db.from('orders').update({ refunded_at: now, refund_reason: reason, refund_amount: cur.total, updated_at: now })
      .eq('id', id).is('refunded_at', null).select('*').maybeSingle();
    if (error) throw new StoreError(error.message, 500);
    if (!data) throw new StoreError(`Order ${cur.token} is already refunded`, 409);
    return toOrder(data as Row);
  }

  async getOverrides(): Promise<Overrides> {
    const [items, options] = await Promise.all([
      this.db.from('menu_overrides').select('item_id,name,description,price,sold_out_on'),
      this.db.from('option_overrides').select('group_id,option_id,price'),
    ]);
    // Before migration 0003 is run the tables don't exist yet: keep the kiosk selling from the menu
    // in code rather than failing every order. Any other error is real and goes up.
    const missing = (e: { code?: string } | null) => e?.code === '42P01' || e?.code === 'PGRST205';
    if (missing(items.error) || missing(options.error)) { console.error('menu_overrides/option_overrides missing: run supabase/migrations/0003_owner_dashboard.sql'); return { items: {}, options: {} }; }
    if (items.error) throw new StoreError(items.error.message, 500);
    if (options.error) throw new StoreError(options.error.message, 500);
    const today = istDay();
    const out: Overrides = { items: {}, options: {} };
    for (const r of items.data as { item_id: string; name: string | null; description: string | null; price: number | null; sold_out_on: string | null }[]) {
      out.items[r.item_id] = { name: r.name, desc: r.description, price: r.price, soldOut: r.sold_out_on === today };
    }
    for (const r of options.data as { group_id: string; option_id: string; price: number }[]) out.options[optionKey(r.group_id, r.option_id)] = r.price;
    return out;
  }

  async saveItem(itemId: string, patch: ItemPatch) {
    const row: Record<string, unknown> = { item_id: itemId, updated_at: new Date().toISOString() };
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.desc !== undefined) row.description = patch.desc;
    if (patch.price !== undefined) row.price = patch.price;
    if (patch.soldOut !== undefined) row.sold_out_on = patch.soldOut ? istDay() : null;
    const { error } = await this.db.from('menu_overrides').upsert(row, { onConflict: 'item_id' });
    if (error) throw new StoreError(error.message, 500);
  }

  async saveOptionPrice(groupId: string, optionId: string, price: number) {
    const { error } = await this.db.from('option_overrides').upsert({ group_id: groupId, option_id: optionId, price, updated_at: new Date().toISOString() }, { onConflict: 'group_id,option_id' });
    if (error) throw new StoreError(error.message, 500);
  }

  async addEvent(e: Omit<AdminEvent, 'at'>) {
    const { error } = await this.db.from('admin_events').insert({ kind: e.kind, subject: e.subject, before: e.before ?? null, after: e.after ?? null, note: e.note ?? null });
    if (error) throw new StoreError(error.message, 500);
  }

  async listEvents(limit = 100) {
    const { data, error } = await this.db.from('admin_events').select('at,kind,subject,before,after,note').order('at', { ascending: false }).limit(limit);
    if (error) throw new StoreError(error.message, 500);
    return data as AdminEvent[];
  }
}
