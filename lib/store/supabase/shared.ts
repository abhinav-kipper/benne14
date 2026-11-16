// Row shapes, mappers and error helpers shared by the Supabase store's files.
import { type SupabaseClient } from '@supabase/supabase-js';
import type { DiscountCode } from '../../discounts';
import { plainToken, type AdminEvent, type Order, type OrderStatus } from '../../orders';
import { StoreError } from '../memory';

export type Db = SupabaseClient;

export interface Row {
  id: string;
  token: string;
  token_day: string;
  type: Order['type'];
  customer_name: string | null;
  pay_method: Order['payMethod'];
  status: OrderStatus;
  lines: Order['lines'];
  item_count: number;
  subtotal: string | number;
  cgst: string | number;
  sgst: string | number;
  round_off: string | number;
  total: string | number;
  savings: string | number;
  discount_code?: string | null;
  pay_gateway?: string | null;
  pay_ref?: string | null;
  given?: number[] | null;
  created_at: string;
  updated_at: string;
  paid_at: string | null;
  invoice_no?: string | null; // from migration 0015
  ready_at: string | null;
  refunded_at?: string | null;
  refund_reason?: string | null;
  refund_amount?: string | number | null;
}

export const PHOTO_BUCKET = 'dish-photos';
export const DB_TIMEOUT_MS = 8000;
export interface DishRow {
  id: string;
  cat: string;
  name: string;
  description: string;
  price: number;
  groups: unknown;
  photo: string | null;
  live: boolean;
}

// A table or function from a migration that hasn't been run yet.
export const missing = (e: { code?: string } | null) =>
  e?.code === '42P01' || e?.code === 'PGRST205' || e?.code === 'PGRST202' || e?.code === '42883';

export interface CodeRow {
  code: string;
  kind: DiscountCode['kind'];
  value: number;
  min_order: number | null;
  max_discount: number | null;
  expires_on: string | null;
  active: boolean;
}
export const toCode = (r: CodeRow): DiscountCode => ({
  code: r.code,
  kind: r.kind,
  value: r.value,
  minOrder: r.min_order,
  maxDiscount: r.max_discount,
  expiresOn: r.expires_on,
  active: r.active,
});
export const eventRow = (v: Omit<AdminEvent, 'at'>) => ({
  kind: v.kind,
  subject: v.subject,
  before: v.before ?? null,
  after: v.after ?? null,
  note: v.note ?? null,
});

// A column from a migration that hasn't been run yet (Postgres, or PostgREST's own check of the request).
export const noColumn = (e: { code?: string } | null) => e?.code === '42703' || e?.code === 'PGRST204';

// The database's own guard (migration 0006) refused the change: it is a conflict, not a crash.
export const storeError = (e: { message: string; code?: string }) =>
  new StoreError(e.message, e.code === 'P0001' || e.code === '23514' ? 409 : 500);

export const toOrder = (r: Row): Order => ({
  id: r.id,
  token: plainToken(r.token),
  tokenDay: r.token_day,
  type: r.type,
  customerName: r.customer_name,
  payMethod: r.pay_method,
  status: r.status,
  lines: r.lines,
  itemCount: r.item_count,
  subtotal: +r.subtotal,
  cgst: +r.cgst,
  sgst: +r.sgst,
  roundOff: +r.round_off,
  total: +r.total,
  savings: +r.savings,
  discountCode: r.discount_code ?? null,
  payGateway: r.pay_gateway ?? null,
  payRef: r.pay_ref ?? null,
  given: r.given ?? [],
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  paidAt: r.paid_at,
  invoiceNo: r.invoice_no ?? null,
  readyAt: r.ready_at,
  refundedAt: r.refunded_at ?? null,
  refundReason: r.refund_reason ?? null,
  refundAmount: r.refund_amount == null ? null : +r.refund_amount,
});
