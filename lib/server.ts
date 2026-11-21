// Small helpers for API route handlers.
import 'server-only';
import { after, NextResponse } from 'next/server';
import { OrderError } from './pricing';
import { checkKioskKey, makeKioskKey } from './kioskkey';
import { FailureLimiter } from './ratelimit';
import { getStore } from './store';
import { StoreError } from './store/memory';
import { clip } from './system';
import { SLOW_MS } from './tech';
import { BUILD_ID } from './version';

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
  recordServerError(e);
  return json({ error: 'Something went wrong' }, 500);
}

// Something the server could not handle: keep it for the owner app's System page. Never awaited
// and never allowed to throw: reporting a failure must not become a second failure.
export function recordServerError(e: unknown) {
  try {
    const err = e instanceof Error ? e : new Error(String(e));
    void getStore()
      .logError({
        source: 'server',
        message: clip(err.message, 300) || 'Unknown error',
        detail: clip(err.stack, 2000) || null,
        build: BUILD_ID,
        device: null,
      })
      .catch(() => {});
  } catch {
    // no store: nothing to record it in
  }
}

// How long a step took, kept for the owner app's technical page (lib/tech.ts). `slowOnly` is for
// steps that run all day (polling): they are recorded only when slow or failed. Recording happens
// after the answer has gone out and can never fail the step it measures.
export async function timed<T>(op: string, run: () => Promise<T>, slowOnly = false): Promise<T> {
  const start = Date.now();
  let ok = false;
  try {
    const out = await run();
    ok = !(out instanceof Response) || out.status < 500;
    return out;
  } finally {
    const ms = Date.now() - start;
    if (!slowOnly || !ok || ms >= SLOW_MS) {
      const save = () =>
        getStore()
          .logTiming({ op, ms, ok, build: BUILD_ID })
          .catch(() => {});
      try {
        after(save);
      } catch {
        void save(); // outside a request (tests): just don't wait for it
      }
    }
  }
}

// A small counter per key (an address, usually): true once `max` calls arrived within `ms`. In
// memory and per server instance, so it is a brake on abuse of the open endpoints, not a wall.
const hits = new Map<string, { n: number; until: number }>();
export function limited(key: string, max: number, ms: number): boolean {
  const now = Date.now();
  if (hits.size > 5000) for (const [k, v] of hits) if (v.until < now) hits.delete(k);
  const h = hits.get(key);
  if (!h || h.until < now) {
    hits.set(key, { n: 1, until: now + ms });
    return false;
  }
  return ++h.n > max;
}

// Two PINs. The staff PIN opens the kitchen screen and sets a tablet up as the kiosk. The owner PIN
// (OWNER_PIN, six digits) opens the owner app: takings, prices, the menu, refunds. The owner PIN
// also does everything the staff PIN does. Until OWNER_PIN is set the owner app still opens with
// the staff PIN, so nothing locks anyone out on the day this ships (the System page says so).
// In production STAFF_PIN must be set; for local demos on the in-memory store it falls back to 1414.
// trim(): a PIN pasted into Vercel with a trailing space or newline would otherwise never match.
export const staffPin = () => (process.env.STAFF_PIN ?? (process.env.NODE_ENV === 'production' ? '' : '1414')).trim();
export const ownerPin = () => (process.env.OWNER_PIN ?? '').trim();
const sent = (req: Request) => req.headers.get('x-staff-pin')?.trim() ?? '';
export function staffOk(req: Request): boolean {
  const pin = sent(req);
  return !!pin && ((!!staffPin() && pin === staffPin()) || (!!ownerPin() && pin === ownerPin()));
}
function ownerOk(req: Request): boolean {
  return ownerPin() ? sent(req) === ownerPin() : staffOk(req);
}

// A lockout after repeated wrong PINs from one address (a short PIN is otherwise guessable in
// minutes). 'locked' → 429.
// 30 per 10 minutes: the shop's tablets share one Wi-Fi address, so the limit must survive a few
// fumbled PINs across devices, while 10,000 guesses still take over two days.
const pinFailures = new FailureLimiter(30, 10 * 60_000);
export const clientKey = (req: Request) =>
  req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip') || 'local';
function pinCheck(req: Request, ok: (r: Request) => boolean): 'ok' | 'bad' | 'locked' {
  const key = clientKey(req);
  if (pinFailures.locked(key)) return 'locked';
  if (ok(req)) return 'ok';
  pinFailures.fail(key);
  return 'bad';
}
export const staffCheck = (req: Request) => pinCheck(req, staffOk);
export const ownerCheck = (req: Request) => pinCheck(req, ownerOk);

// Is this request from a tablet staff have set up as the kiosk? (lib/kioskkey.ts)
const keyExtra = () => process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
export const kioskOk = (req: Request) => checkKioskKey(req.headers.get('x-kiosk-key'), staffPin(), keyExtra());
export const newKioskKey = () => makeKioskKey(staffPin(), keyExtra());
export const staffDenied = (r: 'bad' | 'locked') =>
  r === 'locked'
    ? json({ error: 'Too many wrong PINs. Wait 10 minutes and try again.' }, 429)
    : json({ error: 'Staff PIN needed' }, 401);

// PAYMENTS=mock (tests, demos): fake payee + "Simulate payment". Default is upi-direct: real QR to the shop's UPI ID.
export const paymentsAreMock = () => paymentMode() === 'mock';
// PAYMENTS=easebuzz: UPI goes through the Easebuzz gateway and confirms itself (needs EASEBUZZ_KEY and
// EASEBUZZ_SALT; without them it quietly stays on the shop's own QR).
// PAYMENTS=instacollect: the same account's InstaCollect instead (a QR that pays into the shop's own
// virtual UPI ID). It has its own keys, EASEBUZZ_WIRE_KEY and EASEBUZZ_WIRE_SALT (the gateway's are refused).
// TRIAL (owner's ask, 2026-11-21): the preview of the branch below takes UPI by InstaCollect whatever
// PAYMENTS says, so it can be tried on a phone without touching Vercel's settings. It names one
// branch, so the live site (built from main) and every other preview are unaffected. Remove this
// once InstaCollect has been tried and PAYMENTS is set for real.
const INSTACOLLECT_TRIAL_BRANCH = 'feat/instacollect';
export const wantedPayments = (env: Record<string, string | undefined> = process.env) =>
  env.PAYMENTS !== 'mock' && env.VERCEL_GIT_COMMIT_REF === INSTACOLLECT_TRIAL_BRANCH ? 'instacollect' : env.PAYMENTS;
export const paymentMode = (): 'mock' | 'upi-direct' | 'easebuzz' | 'instacollect' => {
  const want = wantedPayments();
  if (want === 'mock') return 'mock';
  const env = process.env;
  const gatewayKeys = !!env.EASEBUZZ_KEY && !!env.EASEBUZZ_SALT;
  if (want === 'easebuzz' && gatewayKeys) return want;
  // the gateway's pair stands in only where Easebuzz made the two the same (and in the tests)
  if (want === 'instacollect' && ((!!env.EASEBUZZ_WIRE_KEY && !!env.EASEBUZZ_WIRE_SALT) || gatewayKeys)) return want;
  return 'upi-direct';
};
// Is UPI confirmed by a gateway (and so by itself), whichever of the two it is?
export const gatewayOn = () => paymentMode() === 'easebuzz' || paymentMode() === 'instacollect';
