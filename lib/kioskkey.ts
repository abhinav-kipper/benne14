// The key a tablet holds once staff have set it up as the shop's kiosk (staff PIN, once). Orders
// are accepted only with a valid key, so a stranger's browser cannot send orders to the kitchen.
// The key is "k1.<random>.<signature>": the server checks the signature and keeps no list. The
// signing secret is derived from the staff PIN and the database key, so changing either one
// un-enrols every tablet (they ask for the PIN again).
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const secret = (pin: string, extra: string) => createHash('sha256').update(`kiosk|${pin}|${extra}`).digest();
const sign = (pin: string, extra: string, id: string) =>
  createHmac('sha256', secret(pin, extra)).update(id).digest('base64url').slice(0, 32);

export function makeKioskKey(pin: string, extra: string, id = randomBytes(9).toString('base64url')): string {
  return `k1.${id}.${sign(pin, extra, id)}`;
}

export function checkKioskKey(key: unknown, pin: string, extra: string): boolean {
  if (typeof key !== 'string' || key.length > 100 || !pin) return false;
  const m = /^k1\.([A-Za-z0-9_-]{6,24})\.([A-Za-z0-9_-]{32})$/.exec(key);
  if (!m) return false;
  const want = Buffer.from(sign(pin, extra, m[1]));
  const got = Buffer.from(m[2]);
  return want.length === got.length && timingSafeEqual(want, got);
}
