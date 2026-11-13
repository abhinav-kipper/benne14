// Order storage. Supabase when its env vars are set; otherwise an in-memory store so the app runs
// (and tests pass) with no database. Only server code imports this.
import 'server-only';
import type { Overrides } from '../menu';
import type { AdminEvent, Order, OrderStatus, PlaceOrderInput } from '../orders';
import { MemoryStore, StoreError } from './memory';
import { SupabaseStore } from './supabase';

export interface Store {
  readonly kind: 'memory' | 'supabase';
  placeOrder(input: PlaceOrderInput): Promise<Order>; // idempotent on input.key
  getOrder(id: string): Promise<Order | null>;
  listLive(): Promise<Order[]>; // unfinished orders from the last LIVE_HOURS (any date), plus just handed over
  listToday(): Promise<Order[]>; // every order placed today, newest first (kitchen history, dashboard)
  listCollected(limit: number): Promise<{ id: string; token: string }[]>; // today's last handed-over orders, newest first (TV)
  // `from`: the status the caller last saw. If the order has moved on since (another tablet), the
  // change is refused with 409 instead of silently undoing the other tablet's tap.
  setStatus(id: string, to: OrderStatus, from?: OrderStatus): Promise<Order>;

  // Owner dashboard
  listRange(fromDay: string, toDay: string): Promise<Order[]>; // orders placed on these IST days, oldest first
  refund(id: string, reason: string): Promise<Order>; // paid, not yet refunded orders only (else 409)
  getOverrides(): Promise<Overrides>; // owner's menu changes; soldOut only for today
  // One menu edit: the dish's fields, any extras' prices and the history lines, saved together.
  saveMenuEdit(edit: MenuEdit): Promise<void>;
  addEvent(e: Omit<AdminEvent, 'at'>): Promise<void>;
  listEvents(limit?: number): Promise<AdminEvent[]>; // newest first
  appliedMigrations(): Promise<string[]>; // names recorded in schema_migrations ([] before 0004 is run)
}

// undefined = leave as is; null = back to the menu in code.
export interface ItemPatch { name?: string | null; desc?: string | null; price?: number | null; soldOut?: boolean }
export interface MenuEdit {
  itemId: string;
  patch: ItemPatch;
  options: { groupId: string; optionId: string; price: number }[];
  events: Omit<AdminEvent, 'at'>[];
}

let store: Store | undefined;

export function getStore(): Store {
  if (store) return store;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Supabase's new "secret" key (sb_secret_…) or the legacy service_role key. Server-only, never NEXT_PUBLIC.
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (key?.startsWith('sb_publishable_')) throw new StoreError('SUPABASE_SECRET_KEY holds the publishable key; use the sb_secret_ key', 503);
  if (url && key) return (store = new SupabaseStore(url, key));
  // On Vercel every request can land on a different instance, so in-memory orders would vanish.
  if (process.env.VERCEL) throw new StoreError('Database not configured: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY', 503);
  return (store = MemoryStore.shared());
}

// What kind of key is configured, without revealing it (for /api/health).
export function keyKind(): 'secret' | 'legacy-service-role' | 'publishable (wrong key)' | 'missing' {
  const k = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) return 'missing';
  if (k.startsWith('sb_secret_')) return 'secret';
  if (k.startsWith('sb_publishable_')) return 'publishable (wrong key)';
  return 'legacy-service-role';
}
