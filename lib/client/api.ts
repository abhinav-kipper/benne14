// What the kiosk, kitchen, TV and phone bill ask the server.
import type { DiscountRule, KioskSettings } from '../discounts';
import type { CartLine } from '../pricing';
import type { Overrides } from '../menu';
import type { Order, OrderStatus, OrderType, PayMethod } from '../orders';
import { call } from './http';

// direct: the shop's own QR, staff confirm (only when no gateway is set up). page: the gateway's
// payment page in a frame. qr: a QR drawn from the gateway's UPI link; those two confirm by
// themselves. down: the gateway is not answering, so the kiosk offers card and cash instead.
export type GatewayView =
  { kind: 'direct' } | { kind: 'page'; url: string } | { kind: 'qr'; svg: string } | { kind: 'down' };

const KIOSK_KEY = 'benne14.kioskKey';
function kioskHeader(): Record<string, string> {
  try {
    const k = localStorage.getItem(KIOSK_KEY);
    return k ? { 'x-kiosk-key': k } : {};
  } catch {
    return {};
  }
}

export const api = {
  placeOrder: (b: {
    key: string;
    type: OrderType;
    name: string | null;
    payMethod: PayMethod;
    lines: CartLine[];
    code?: string | null;
    phone?: string | null;
    expectTotal?: number; // the total the customer was shown; the server refuses if its own differs
  }) => call<Order>('/api/orders', { method: 'POST', body: JSON.stringify(b), headers: kioskHeader() }),
  // What the cart asks for (the owner's switches), and whether a code works for this cart.
  // enrolled: is this tablet set up as the shop's kiosk (see lib/kioskkey.ts)?
  kiosk: () => call<KioskSettings & { enrolled: boolean }>('/api/kiosk', { headers: kioskHeader() }),
  // Staff set this tablet up as the kiosk: the PIN is typed once and the tablet keeps a key.
  enrolKiosk: async (pin: string) => {
    const { key } = await call<{ key: string }>('/api/kiosk', { method: 'POST', headers: { 'x-staff-pin': pin } });
    try {
      localStorage.setItem(KIOSK_KEY, key);
    } catch {
      // no storage: the tablet will ask again after a reload
    }
  },
  pinDigits: () => call<{ staffDigits: number; ownerDigits: number }>('/api/staff'),
  popular: () => call<{ ids: string[] }>('/api/popular'),
  checkCode: (code: string, lines: CartLine[]) =>
    call<{ rule: DiscountRule; amount: number; short: number }>('/api/discounts/check', {
      method: 'POST',
      body: JSON.stringify({ code, lines }),
    }),
  order: (id: string) => call<Order>(`/api/orders/${id}`),
  live: () => call<Order[]>('/api/orders'),
  today: () => call<Order[]>('/api/orders?view=today'),
  collected: () => call<{ id: string; token: string }[]>('/api/orders?view=collected'),
  menu: () => call<Overrides>('/api/menu'),
  checkPin: (pin: string, who: 'staff' | 'owner' = 'staff') =>
    call<{ ok: true }>(`/api/staff${who === 'owner' ? '?for=owner' : ''}`, {
      method: 'POST',
      headers: { 'x-staff-pin': pin },
    }),
  claim: (id: string, action: 'paid' | 'cancel') =>
    call<Order>(`/api/orders/${id}/claim`, { method: 'POST', body: JSON.stringify({ action }) }),
  mockPay: (id: string) => call<Order>(`/api/orders/${id}/pay`, { method: 'POST' }),
  // The payment gateway, for the kiosk's UPI screen: how to show this order's payment, and "is it paid yet?"
  gatewayStart: (id: string) =>
    call<GatewayView>(`/api/orders/${id}/gateway`, { method: 'POST', body: JSON.stringify({ action: 'start' }) }),
  gatewayCheck: (id: string) =>
    call<{ order: Order; state: 'paid' | 'failed' | 'waiting' | 'problem'; gatewayStatus?: string }>(
      `/api/orders/${id}/gateway`,
      {
        method: 'POST',
        body: JSON.stringify({ action: 'check' }),
      },
    ),
  // `from` = the status this screen shows; the server refuses (409) if another screen changed it first.
  setGiven: (id: string, line: number, count: number, pin: string) =>
    call<Order>(`/api/orders/${id}/given`, {
      method: 'POST',
      body: JSON.stringify({ line, count }),
      headers: { 'x-staff-pin': pin },
    }),
  setStatus: (id: string, to: OrderStatus, pin: string, from?: OrderStatus) =>
    call<Order>(`/api/orders/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ to, from }),
      headers: { 'x-staff-pin': pin },
    }),
};

export const newKey = () =>
  crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
