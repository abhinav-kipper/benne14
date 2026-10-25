// Order storage. Supabase when its env vars are set; otherwise an in-memory store so the app runs
// (and tests pass) with no database. Only server code imports this.
import 'server-only';
import type { Order, OrderStatus, PlaceOrderInput } from '../orders';
import { MemoryStore, StoreError } from './memory';
import { SupabaseStore } from './supabase';

export interface Store {
  readonly kind: 'memory' | 'supabase';
  placeOrder(input: PlaceOrderInput): Promise<Order>; // idempotent on input.key
  getOrder(id: string): Promise<Order | null>;
  listLive(): Promise<Order[]>; // today's orders the kitchen/board show, plus recently handed over
  setStatus(id: string, to: OrderStatus): Promise<Order>;
}

let store: Store | undefined;

export function getStore(): Store {
  if (store) return store;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Supabase's new "secret" key (sb_secret_…) or the legacy service_role key. Server-only, never NEXT_PUBLIC.
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) return (store = new SupabaseStore(url, key));
  // On Vercel every request can land on a different instance, so in-memory orders would vanish.
  if (process.env.VERCEL) throw new StoreError('Database not configured: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY', 503);
  return (store = MemoryStore.shared());
}
