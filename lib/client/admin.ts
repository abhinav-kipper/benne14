// What the owner app asks the server; every call carries the owner PIN.
import type { Customer, DiscountCode, KioskSettings } from '../discounts';
import { type Alert, type Device, type ErrorEntry, type Problem } from '../system';
import type { TechReport } from '../tech';
import type { CustomItem, Overrides } from '../menu';
import type { AdminEvent, Order, OrderEvent } from '../orders';
import type { Summary } from '../reports';
import { ApiError, call } from './http';

const pinHeader = (pin: string) => ({ 'x-staff-pin': pin });
export interface Report {
  from: string;
  to: string;
  current: Summary;
  previous: { from: string; to: string; summary: Summary };
}
export interface SystemReport {
  now: string;
  build: string;
  store: string;
  payments: string;
  testMode: boolean;
  devices: Device[];
  errors: ErrorEntry[];
  problems: Problem[];
  alerts: Alert[]; // what was announced to the owner's phone: open ones first
  phones: number; // phones with notifications on
}
export const admin = {
  report: (pin: string, from: string, to: string) =>
    call<Report>(`/api/admin/report?from=${from}&to=${to}`, { headers: pinHeader(pin) }),
  events: (pin: string) => call<AdminEvent[]>('/api/admin/events', { headers: pinHeader(pin) }),
  orderEvents: (pin: string, id: string) =>
    call<OrderEvent[]>(`/api/admin/orders/${id}/events`, { headers: pinHeader(pin) }),
  // One request per edit: the dish's fields and any extras' prices save together or not at all.
  saveItem: (
    pin: string,
    b: {
      itemId: string;
      name?: string | null;
      desc?: string | null;
      price?: number | null;
      soldOut?: boolean;
      options?: { groupId: string; optionId: string; price: number }[];
    },
  ) => call('/api/admin/menu', { method: 'POST', body: JSON.stringify(b), headers: pinHeader(pin) }),
  // The owner's whole menu (drafts and hidden dishes included) and one change to it at a time.
  dishes: (pin: string) => call<Overrides>('/api/admin/dishes', { headers: pinHeader(pin) }),
  menuChange: (
    pin: string,
    b:
      | { dish: Omit<CustomItem, 'id' | 'live'> & { id?: string } }
      | { publish: string }
      | { discard: string }
      | { hide: string }
      | { show: string }
      | { order: string[] }
      | { section: { id?: string; name: string } }
      | { removeSection: string }
      | { hideSection: string }
      | { showSection: string }
      | { sectionOrder: string[] },
  ) =>
    call<{ dish?: CustomItem }>('/api/admin/dishes', {
      method: 'POST',
      body: JSON.stringify(b),
      headers: pinHeader(pin),
    }),
  // Extras and kitchen notes, one change at a time (see app/api/admin/extras/route.ts).
  extrasChange: (
    pin: string,
    b:
      | { extra: { set: string; id?: string; name: string; price: number } }
      | { hideExtra: string }
      | { showExtra: string }
      | { set: { id?: string; name: string } }
      | { removeSet: string }
      | { dishSets: { itemId: string; sets: string[] } }
      | { note: { id?: string; label: string; tone: 'add' | 'less' | null; cats: string[] } }
      | { hideNote: string }
      | { showNote: string },
  ) =>
    call<{ extra?: { id: string }; set?: { id: string; name: string }; note?: { id: string } }>('/api/admin/extras', {
      method: 'POST',
      body: JSON.stringify(b),
      headers: pinHeader(pin),
    }),
  system: (pin: string) => call<SystemReport>('/api/admin/system', { headers: pinHeader(pin) }),
  tech: (pin: string) => call<TechReport>('/api/admin/tech', { headers: pinHeader(pin) }),
  pushInfo: (pin: string) =>
    call<{ publicKey: string; phones: number }>('/api/admin/push', { headers: pinHeader(pin) }),
  pushChange: (pin: string, b: { subscribe: PushSubscriptionJSON } | { unsubscribe: string } | { test: true }) =>
    call<{ phones?: number; sent?: number }>('/api/admin/push', {
      method: 'POST',
      body: JSON.stringify(b),
      headers: pinHeader(pin),
    }),
  photo: (pin: string, jpeg: Blob) =>
    call<{ url: string }>('/api/admin/photo', {
      method: 'POST',
      body: jpeg,
      timeoutMs: 45_000, // a photo on a slow connection
      headers: { ...pinHeader(pin), 'Content-Type': 'image/jpeg' },
    }),
  refund: (pin: string, id: string, reason: string) =>
    call<Order>(`/api/admin/orders/${id}/refund`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
      headers: pinHeader(pin),
    }),
  offers: (pin: string) =>
    call<{ settings: KioskSettings; codes: DiscountCode[]; today: string }>('/api/admin/offers', {
      headers: pinHeader(pin),
    }),
  saveSettings: (pin: string, settings: Partial<KioskSettings>) =>
    call<{ settings: KioskSettings }>('/api/admin/offers', {
      method: 'POST',
      body: JSON.stringify({ settings }),
      headers: pinHeader(pin),
    }),
  saveCode: (pin: string, code: Partial<DiscountCode> & { code: string }) =>
    call<{ code: DiscountCode }>('/api/admin/offers', {
      method: 'POST',
      body: JSON.stringify({ code }),
      headers: pinHeader(pin),
    }),
  deleteCode: (pin: string, code: string) =>
    call<{ removed: string }>('/api/admin/offers', {
      method: 'POST',
      body: JSON.stringify({ remove: code }),
      headers: pinHeader(pin),
    }),
  customers: (pin: string) => call<Customer[]>('/api/admin/customers', { headers: pinHeader(pin) }),
  // CSV comes back as a file; the browser saves it (a plain link can't send the PIN header).
  async download(pin: string, kind: 'bills' | 'gst' | 'dishes' | 'customers', from = '', to = '') {
    const url0 =
      kind === 'customers' ? '/api/admin/customers?format=csv' : `/api/admin/export?kind=${kind}&from=${from}&to=${to}`;
    const r = await fetch(url0, {
      headers: pinHeader(pin),
      cache: 'no-store',
    });
    if (!r.ok)
      throw new ApiError(
        ((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`,
        r.status,
      );
    const url = URL.createObjectURL(await r.blob());
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: kind === 'customers' ? 'benne14-customers.csv' : `benne14-${kind}-${from}-to-${to}.csv`,
    });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },
};
