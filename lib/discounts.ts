// Discount codes, the customer's phone number and the owner's kiosk switches. Pure helpers shared
// by the server (which decides) and the kiosk (which only shows what the server will charge).

export interface DiscountCode {
  code: string; // upper case, 3–16 letters and digits
  kind: 'percent' | 'flat';
  value: number; // percent: 1–90; flat: whole rupees
  minOrder: number | null; // item total (before GST) needed to use it
  maxDiscount: number | null; // cap for a percentage code, whole rupees
  expiresOn: string | null; // last day it works, YYYY-MM-DD (IST)
  active: boolean;
}

// What the kiosk needs to show a code's effect: the rule without the owner-only fields.
export type DiscountRule = Pick<DiscountCode, 'code' | 'kind' | 'value' | 'minOrder' | 'maxDiscount'>;

// The owner's switches for the kiosk. `codes` on the kiosk also needs at least one usable code.
export interface KioskSettings {
  codes: boolean;
  phone: boolean;
}
export const DEFAULT_SETTINGS: KioskSettings = { codes: true, phone: true };

// "welcome 10" → "WELCOME10". null when it can't be a code.
export function cleanCode(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\s-]/g, '').toUpperCase();
  return /^[A-Z0-9]{3,16}$/.test(s) ? s : null;
}

export const usable = (c: DiscountCode, today: string) => c.active && (!c.expiresOn || c.expiresOn >= today);

// How much a code takes off an item total (whole rupees, before GST). `short` is how many rupees
// the order is below the code's minimum, when it is. At least ₹1 always remains to pay.
export function discountFor(itemTotal: number, r: DiscountRule): { amount: number; short: number } {
  if (r.minOrder && itemTotal < r.minOrder) return { amount: 0, short: Math.ceil(r.minOrder - itemTotal) };
  // integers only: a percentage is rounded half-up to the rupee
  let amount = r.kind === 'percent' ? Math.floor((itemTotal * r.value + 50) / 100) : r.value;
  if (r.kind === 'percent' && r.maxDiscount) amount = Math.min(amount, r.maxDiscount);
  return { amount: Math.max(0, Math.min(amount, Math.floor(itemTotal) - 1)), short: 0 };
}

export const describeCode = (c: Pick<DiscountCode, 'kind' | 'value' | 'minOrder' | 'maxDiscount'>) =>
  [
    c.kind === 'percent' ? `${c.value}% off` : `₹${c.value} off`,
    c.kind === 'percent' && c.maxDiscount ? `up to ₹${c.maxDiscount}` : '',
    c.minOrder ? `on ₹${c.minOrder} or more` : '',
  ]
    .filter(Boolean)
    .join(' ');

// An Indian mobile number as ten digits ("98765 43210", "+91 98765-43210", "09876543210" → "9876543210").
// null when it isn't one. '' / missing is "not given", which is fine: the number is optional.
export function cleanPhone(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  let d = v.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

// One row of the dashboard's customer list: a phone number and what it has ordered (paid orders only).
export interface Customer {
  phone: string;
  name: string | null; // the latest name given with this number
  orders: number;
  spent: number; // whole rupees, refunds left out
  firstOrderAt: string; // also when they first agreed to offers: the kiosk only takes a number with that line shown
  lastOrderAt: string;
}
