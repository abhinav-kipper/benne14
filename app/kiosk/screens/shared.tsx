'use client';
// Pieces the kiosk screens share: the cart line type, timings, the dish photo and two icons.
import { photoOf, type MenuItem } from '@/lib/menu';
import type { CartLine } from '@/lib/pricing';

export type Screen = 'home' | 'menu' | 'cart' | 'pay' | 'upi' | 'done';
export interface Line extends CartLine {
  uid: string;
}

export const IDLE_MS = 60_000; // "Still there?" after this long without a touch
export const IDLE_GRACE_S = 15;
// The order-number screen: time to read the number and scan the bill, then it asks before clearing for the
// next customer.
export const DONE_STAY_S = 100;
export const DONE_GRACE_S = 20;
export const DONE_MORE_S = 60; // what "I need more time" adds

export function Photo({ item, big }: { item: MenuItem; big?: boolean }) {
  const src = photoOf(item.id);
  return src ? (
    <img src={src} alt="" />
  ) : (
    <div className="nophoto" style={big ? { fontSize: 80 } : undefined}>
      {item.placeholder ?? 'Coffee'}
    </div>
  );
}

export const DineIcon = () => (
  <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
    <circle cx="32" cy="34" r="20" />
    <circle cx="32" cy="34" r="12" />
    <path d="M6 12v14m0 0c0 3 4 3 4 0V12m-2 14v28M58 12c-4 4-4 14 0 16v26" />
  </svg>
);
export const BagIcon = () => (
  <svg
    viewBox="0 0 64 64"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinejoin="round"
    strokeLinecap="round"
  >
    <path d="M12 22h40l-3 34H15z" />
    <path d="M23 22v-4a9 9 0 0 1 18 0v4" />
    <path d="M26 38c4 4 8 4 12 0" />
  </svg>
);
