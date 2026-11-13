// Small helpers for API route handlers.
import 'server-only';
import { NextResponse } from 'next/server';
import { OrderError } from './pricing';
import { FailureLimiter } from './ratelimit';
import { StoreError } from './store/memory';

export const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

// A request body that isn't a JSON object is the caller's mistake (400), never a server crash (500).
export class BadRequest extends Error {}
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new BadRequest('Body must be JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequest('Body must be a JSON object');
  return body as Record<string, unknown>;
}

// Order ids are uuids. Anything else is "not found" (Postgres would otherwise throw on the cast).
export const isOrderId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
export const notFound = () => json({ error: 'Order not found' }, 404);

export function fail(e: unknown) {
  if (e instanceof BadRequest) return json({ error: e.message }, 400);
  if (e instanceof OrderError) return json({ error: e.message }, 400);
  if (e instanceof StoreError) return json({ error: e.message }, e.status);
  console.error(e);
  return json({ error: 'Something went wrong' }, 500);
}

// Staff actions (kitchen, counter) need the shop PIN. In production STAFF_PIN must be set;
// for local demos on the in-memory store it falls back to 1414.
export function staffOk(req: Request): boolean {
  // trim(): a PIN pasted into Vercel with a trailing space or newline would otherwise never match.
  const pin = (process.env.STAFF_PIN ?? (process.env.NODE_ENV === 'production' ? '' : '1414')).trim();
  return !!pin && req.headers.get('x-staff-pin')?.trim() === pin;
}

// staffOk plus a lockout after repeated wrong PINs from one address (a 4-digit PIN is otherwise
// guessable in minutes). 'locked' → 429.
// 30 per 10 minutes: the shop's tablets share one Wi-Fi address, so the limit must survive a few
// fumbled PINs across devices, while 10,000 guesses still take over two days.
const pinFailures = new FailureLimiter(30, 10 * 60_000);
export const clientKey = (req: Request) =>
  req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip') || 'local';
export function staffCheck(req: Request): 'ok' | 'bad' | 'locked' {
  const key = clientKey(req);
  if (pinFailures.locked(key)) return 'locked';
  if (staffOk(req)) return 'ok';
  pinFailures.fail(key);
  return 'bad';
}
export const staffDenied = (r: 'bad' | 'locked') =>
  r === 'locked'
    ? json({ error: 'Too many wrong PINs. Wait 10 minutes and try again.' }, 429)
    : json({ error: 'Staff PIN needed' }, 401);

// PAYMENTS=mock (tests, demos): fake payee + "Simulate payment". Default is upi-direct: real QR to the shop's UPI ID.
export const paymentsAreMock = () => paymentMode() === 'mock';
export const paymentMode = (): 'mock' | 'upi-direct' => (process.env.PAYMENTS === 'mock' ? 'mock' : 'upi-direct');
