// Order storage. Supabase when its env vars are set; otherwise an in-memory store so the app runs
// (and tests pass) with no database. Only server code imports this.
import 'server-only';
import type { Customer, DiscountCode, KioskSettings } from '../discounts';
import type { CustomItem, ExtrasLayout, Overrides, SectionsLayout } from '../menu';
import type { AdminEvent, GatewayPayment, Order, OrderEvent, OrderStatus, PlaceOrderInput } from '../orders';
import type { Alert, Device, DeviceKind, ErrorEntry } from '../system';
import { MemoryStore, StoreError } from './memory';
import { SupabaseStore } from './supabase';

export interface Store {
  readonly kind: 'memory' | 'supabase';
  placeOrder(input: PlaceOrderInput): Promise<Order>; // idempotent on input.key
  // The latest order placed under this kiosk checkout key, with the request fingerprint it was stored
  // under (null for orders from before fingerprints). Lets the API tell a retry from a changed order.
  findByCheckout(key: string): Promise<{ order: Order; fingerprint: string | null } | null>;
  getOrder(id: string): Promise<Order | null>;
  listLive(): Promise<Order[]>; // unfinished orders from the last LIVE_HOURS (any date), plus just handed over
  listToday(): Promise<Order[]>; // every order placed today, newest first (kitchen history, dashboard)
  listCollected(limit: number): Promise<{ id: string; token: string }[]>; // today's last handed-over orders, newest first (TV)
  // `from`: the status the caller last saw. If the order has moved on since (another tablet), the
  // change is refused with 409 instead of silently undoing the other tablet's tap.
  setStatus(id: string, to: OrderStatus, from?: OrderStatus): Promise<Order>;
  // Kitchen ticks (migration 0008): `count` of line number `line` have been given to the customer.
  // Only for orders on the kitchen rail (new, cooking), else 409; a tick on a new order starts it.
  setGiven(id: string, line: number, count: number): Promise<Order>;

  // A gateway says this order is paid: move it to the kitchen and keep the gateway's reference, in one
  // step. Harmless to repeat (the same payment again returns the order as it is). 409 when the order
  // can no longer be paid (cancelled): the caller records that for a refund.
  confirmPayment(id: string, p: GatewayPayment): Promise<Order>;
  // An order's own history, oldest first: placed, every change of state, a refund ([] before 0006 is run).
  listOrderEvents(id: string): Promise<OrderEvent[]>;

  // Owner dashboard
  listRange(fromDay: string, toDay: string): Promise<Order[]>; // orders placed on these IST days, oldest first
  refund(id: string, reason: string): Promise<Order>; // paid, not yet refunded orders only (else 409)
  getOverrides(): Promise<Overrides>; // owner's menu changes; soldOut only for today
  // One menu edit: the dish's fields, any extras' prices and the history lines, saved together.
  saveMenuEdit(edit: MenuEdit): Promise<void>;
  // The owner's own dishes and the menu's layout (migration 0009). getOverrides() carries them:
  // custom (drafts included), hidden, order. Before 0009 is run there are none and these refuse (503).
  saveDish(d: CustomItem, event: Omit<AdminEvent, 'at'> | null): Promise<void>; // creates or replaces by id
  deleteDish(id: string, event: Omit<AdminEvent, 'at'>): Promise<void>; // 404 if there is no such dish
  // `sections` (migration 0010) replaces the whole sections layout; the other two are left alone.
  saveLayout(patch: LayoutPatch, event: Omit<AdminEvent, 'at'> | null): Promise<void>;
  savePhoto(jpeg: Uint8Array): Promise<string>; // stores a dish photo, returns the URL to show it from
  addEvent(e: Omit<AdminEvent, 'at'>): Promise<void>;
  listEvents(limit?: number): Promise<AdminEvent[]>; // newest first
  // Discount codes, the kiosk switches and the customer list (migration 0005). Before it is run a
  // Supabase store answers as if there were no codes and both switches were off.
  listCodes(): Promise<DiscountCode[]>; // newest first
  getCode(code: string): Promise<DiscountCode | null>;
  saveCode(c: DiscountCode, event: Omit<AdminEvent, 'at'>): Promise<void>; // creates or replaces by code
  // Removes a code for good. Orders that used it keep its name and their discount (they are snapshots).
  deleteCode(code: string, event: Omit<AdminEvent, 'at'>): Promise<void>; // 404 if there is no such code
  getSettings(): Promise<KioskSettings>;
  saveSettings(patch: Partial<KioskSettings>, events: Omit<AdminEvent, 'at'>[]): Promise<KioskSettings>;
  listCustomers(): Promise<Customer[]>; // phone numbers on paid orders, latest order first
  // Watching the system (migration 0012). Before it is run these do nothing and list nothing:
  // a screen saying "I'm here" must never be what breaks the screen.
  beat(d: { id: string; kind: DeviceKind; screen: string | null; build: string | null }): Promise<void>;
  listDevices(): Promise<Device[]>; // every screen seen in the last two weeks, most recent first
  logError(e: Omit<ErrorEntry, 'at'>): Promise<void>;
  listErrors(limit?: number): Promise<ErrorEntry[]>; // newest first
  // Alerts to the owner's phone (migration 0013). Before it is run: no phones, no alerts, no keys.
  listSubs(): Promise<PushSub[]>;
  saveSub(s: PushSub): Promise<void>;
  dropSub(endpoint: string): Promise<void>;
  // Open an alert for a problem. True only for the caller that opened it (it was not open already),
  // so two servers noticing the same problem send one notification between them.
  openAlert(a: Pick<Alert, 'key' | 'level' | 'text' | 'hint'>): Promise<boolean>;
  clearAlerts(keys: string[]): Promise<void>;
  listAlerts(limit?: number): Promise<Alert[]>; // open ones first, then the latest cleared
  // A value the app keeps for itself. setKeyOnce stores it only if nothing is there yet and
  // answers with what is stored, so every server ends up with the same value.
  getKey(name: string): Promise<string | null>;
  setKeyOnce(name: string, value: string): Promise<string>;
  appliedMigrations(): Promise<string[]>; // names recorded in schema_migrations ([] before 0004 is run)
}

export interface PushSub {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface LayoutPatch {
  hidden?: string[];
  order?: string[];
  sections?: SectionsLayout;
  extras?: ExtrasLayout; // migration 0011; like sections, replaces the whole value
}

// undefined = leave as is; null = back to the menu in code.
export interface ItemPatch {
  name?: string | null;
  desc?: string | null;
  price?: number | null;
  soldOut?: boolean;
}
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
  if (key?.startsWith('sb_publishable_'))
    throw new StoreError('SUPABASE_SECRET_KEY holds the publishable key; use the sb_secret_ key', 503);
  if (url && key) return (store = new SupabaseStore(url, key));
  // On Vercel every request can land on a different instance, so in-memory orders would vanish.
  if (process.env.VERCEL)
    throw new StoreError('Database not configured: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY', 503);
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
