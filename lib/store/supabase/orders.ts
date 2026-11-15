// Orders: placing, reading, moving through the kitchen, payment, refund.
import {
  canMove,
  tickProblem,
  HANDED_MIN,
  isPaid,
  istDay,
  LIVE,
  LIVE_HOURS,
  plainToken,
  UPI_OPEN_MIN,
  type GatewayPayment,
  type Order,
  type OrderEvent,
  type OrderStatus,
  type PlaceOrderInput,
} from '../../orders';
import { StoreError } from '../memory';
import { missing, storeError, toOrder, type Db, type Row } from './shared';

export async function placeOrder(db: Db, input: PlaceOrderInput): Promise<Order> {
  const args = {
    p_key: input.key,
    p_type: input.type,
    p_name: input.customerName ?? '',
    p_pay: input.payMethod,
    p_priced: input.priced,
  };
  // Migration 0005 adds p_phone (and stores the code's name). Without it the order still goes
  // through with the right total; only the phone number and the code's name are not kept.
  let res = await db.rpc('place_order', { ...args, p_phone: input.customerPhone ?? '' });
  if (res.error && missing(res.error)) {
    console.error('place_order has no p_phone: run supabase/migrations/0005_discount_codes_and_phone.sql');
    res = await db.rpc('place_order', args);
  }
  if (res.error) throw new StoreError(res.error.message, 500);
  return toOrder(res.data as Row);
}

export async function findByCheckout(db: Db, key: string) {
  // key is letters, digits, _ and - only (isCheckoutKey), so it is safe inside the filter
  const { data, error } = await db
    .from('orders')
    .select('*')
    .or(`idempotency_key.eq.${key},idempotency_key.like.${key}:*`)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw new StoreError(error.message, 500);
  const row = (data as (Row & { idempotency_key: string })[])[0];
  if (!row) return null;
  const stored = row.idempotency_key;
  return { order: toOrder(row), fingerprint: stored === key ? null : stored.slice(key.length + 1) };
}

export async function getOrder(db: Db, id: string) {
  const { data, error } = await db.from('orders').select('*').eq('id', id).maybeSingle();
  if (error) throw new StoreError(error.message, 500);
  return data ? toOrder(data as Row) : null;
}

export async function listLive(db: Db) {
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
  const { data, error } = await db
    .from('orders')
    .select('*')
    .or(
      `and(status.in.(${LIVE.join(',')}),created_at.gt.${ago(LIVE_HOURS * 3600_000)}),and(status.eq.handed_over,updated_at.gt.${ago(HANDED_MIN * 60_000)}),and(status.eq.pending_payment,created_at.gt.${ago(UPI_OPEN_MIN * 60_000)})`,
    )
    .order('created_at');
  if (error) throw new StoreError(error.message, 500);
  return (data as Row[]).map(toOrder);
}

// Supabase returns at most 1000 rows per request: page through.
async function pages(
  build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
) {
  const out: Order[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new StoreError(error.message, 500);
    out.push(...((data ?? []) as Row[]).map(toOrder));
    if ((data ?? []).length < 1000) return out;
  }
}

export async function listToday(db: Db) {
  return pages((a, b) =>
    db
      .from('orders')
      .select('*')
      .eq('token_day', istDay())
      .order('created_at', { ascending: false })
      .order('id')
      .range(a, b),
  );
}

export async function listCollected(db: Db, limit: number) {
  const { data, error } = await db
    .from('orders')
    .select('id,token')
    .eq('token_day', istDay())
    .eq('status', 'handed_over')
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw new StoreError(error.message, 500);
  return (data as { id: string; token: string }[]).map((r) => ({ id: r.id, token: plainToken(r.token) }));
}

export async function setStatus(db: Db, id: string, to: OrderStatus, from?: OrderStatus) {
  const cur = await getOrder(db, id);
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
  const { data, error } = await db
    .from('orders')
    .update(patch)
    .eq('id', id)
    .eq('status', cur.status)
    .select('*')
    .maybeSingle();
  if (error) throw storeError(error);
  if (!data) throw new StoreError(`Order ${cur.token} was just changed on another screen`, 409);
  return toOrder(data as Row);
}

export async function setGiven(db: Db, id: string, line: number, count: number) {
  const cur = await getOrder(db, id);
  if (!cur) throw new StoreError('Order not found', 404);
  const bad = tickProblem(cur, line, count);
  if (bad) throw new StoreError(bad.message, bad.status);
  // The database does the write under a lock on the order, so ticks from two tablets both count.
  const { data, error } = await db.rpc('set_given', { p_id: id, p_line: line, p_count: count });
  if (missing(error)) {
    console.error('set_given missing: run supabase/migrations/0008_given_ticks.sql');
    throw new StoreError('Ticks need a database update (migration 0008)', 503);
  }
  if (error) throw storeError(error);
  return toOrder(data as Row);
}

export async function confirmPayment(db: Db, id: string, p: GatewayPayment): Promise<Order> {
  const cur = await getOrder(db, id);
  if (!cur) throw new StoreError('Order not found', 404);
  if (isPaid(cur)) return cur;
  if (cur.status === 'cancelled') throw new StoreError(`Order ${cur.token} is cancelled and can't take a payment`, 409);
  const now = new Date().toISOString();
  // One UPDATE: paid, with the gateway's reference, only if nobody changed the order meanwhile.
  const { data, error } = await db
    .from('orders')
    .update({
      status: 'new',
      paid_at: now,
      updated_at: now,
      pay_gateway: p.gateway,
      pay_ref: p.ref,
      pay_bank_ref: p.bankRef ?? null,
    })
    .eq('id', id)
    .eq('status', cur.status)
    .select('*')
    .maybeSingle();
  // Before migration 0007 the reference columns don't exist: the order is still marked paid.
  if (error && (error.code === 'PGRST204' || error.code === '42703')) {
    console.error('pay_ref columns missing: run supabase/migrations/0007_gateway_payments.sql');
    return setStatus(db, id, 'new', cur.status);
  }
  if (error) throw storeError(error);
  if (data) return toOrder(data as Row);
  return confirmPayment(db, id, p); // it changed under us: look again (paid by now, or cancelled)
}

export async function listOrderEvents(db: Db, id: string): Promise<OrderEvent[]> {
  const { data, error } = await db
    .from('order_events')
    .select('at,kind,from_status,to_status,note')
    .eq('order_id', id)
    .order('id');
  if (missing(error)) return [];
  if (error) throw new StoreError(error.message, 500);
  return (
    data as {
      at: string;
      kind: OrderEvent['kind'];
      from_status: string | null;
      to_status: string | null;
      note: string | null;
    }[]
  ).map((r) => ({
    at: r.at,
    kind: r.kind,
    from: r.from_status as OrderStatus | null,
    to: r.to_status as OrderStatus | null,
    note: r.note,
  }));
}

export async function listRange(db: Db, fromDay: string, toDay: string) {
  return pages((a, b) =>
    db
      .from('orders')
      .select('*')
      .gte('token_day', fromDay)
      .lte('token_day', toDay)
      .order('created_at')
      .order('id')
      .range(a, b),
  );
}

export async function refund(db: Db, id: string, reason: string) {
  const cur = await getOrder(db, id);
  if (!cur) throw new StoreError('Order not found', 404);
  if (cur.refundedAt) throw new StoreError(`Order ${cur.token} is already refunded`, 409);
  if (!isPaid(cur))
    throw new StoreError(`Order ${cur.token} isn't paid, so there's nothing to refund. Cancel it instead.`, 409);
  const now = new Date().toISOString();
  const { data, error } = await db
    .from('orders')
    .update({ refunded_at: now, refund_reason: reason, refund_amount: cur.total, updated_at: now })
    .eq('id', id)
    .is('refunded_at', null)
    .select('*')
    .maybeSingle();
  if (error) throw storeError(error);
  if (!data) throw new StoreError(`Order ${cur.token} is already refunded`, 409);
  return toOrder(data as Row);
}
