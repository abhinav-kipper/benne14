// Supabase-backed store. Server only: uses the service role key; tables have RLS with no public policies.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { canMove, istDay, LIVE, type Order, type OrderStatus, type PlaceOrderInput } from '../orders';
import { StoreError } from './memory';

interface Row {
  id: string; token: string; token_day: string; type: Order['type']; customer_name: string | null;
  pay_method: Order['payMethod']; status: OrderStatus; lines: Order['lines']; item_count: number;
  subtotal: string | number; cgst: string | number; sgst: string | number; round_off: string | number;
  total: string | number; savings: string | number;
  created_at: string; updated_at: string; paid_at: string | null; ready_at: string | null;
}

const toOrder = (r: Row): Order => ({
  id: r.id, token: r.token, tokenDay: r.token_day, type: r.type, customerName: r.customer_name,
  payMethod: r.pay_method, status: r.status, lines: r.lines, itemCount: r.item_count,
  subtotal: +r.subtotal, cgst: +r.cgst, sgst: +r.sgst, roundOff: +r.round_off, total: +r.total, savings: +r.savings,
  createdAt: r.created_at, updatedAt: r.updated_at, paidAt: r.paid_at, readyAt: r.ready_at,
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
    const { data, error } = await this.db.from('orders').select('*')
      .eq('token_day', istDay())
      .or(`status.in.(${LIVE.join(',')}),and(status.eq.handed_over,updated_at.gt.${since})`)
      .order('created_at');
    if (error) throw new StoreError(error.message, 500);
    return (data as Row[]).map(toOrder);
  }

  async setStatus(id: string, to: OrderStatus) {
    const cur = await this.getOrder(id);
    if (!cur) throw new StoreError('Order not found', 404);
    if (cur.status === to) return cur;
    if (!canMove(cur.status, to)) throw new StoreError(`Can't move ${cur.token} from ${cur.status} to ${to}`, 409);
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { status: to, updated_at: now };
    if (to === 'new' && !cur.paidAt) patch.paid_at = now;
    if (to === 'ready') patch.ready_at = now;
    if (to === 'cooking') patch.ready_at = null;
    // Conditional on the status we read, so two taps on two tablets can't both win.
    const { data, error } = await this.db.from('orders').update(patch).eq('id', id).eq('status', cur.status).select('*').maybeSingle();
    if (error) throw new StoreError(error.message, 500);
    if (!data) throw new StoreError(`${cur.token} was just changed on another screen`, 409);
    return toOrder(data as Row);
  }
}
