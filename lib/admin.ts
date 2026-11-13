// Server helpers for the owner dashboard's API (/api/admin/*).
import 'server-only';
import { daysBetween, isDay } from './orders';
import { BadRequest, staffCheck, staffDenied } from './server';

// v1 has no owner login (owner's call): the dashboard is behind the same staff PIN as the kitchen.
// Returns a response to send back when the PIN is missing or locked out, else null.
export function adminDenied(req: Request) {
  const r = staffCheck(req);
  return r === 'ok' ? null : staffDenied(r);
}

export const MAX_RANGE_DAYS = 366;

// ?from=YYYY-MM-DD&to=YYYY-MM-DD, at most a year.
export function rangeOf(req: Request) {
  const q = new URL(req.url).searchParams;
  const from = q.get('from'), to = q.get('to');
  if (!isDay(from) || !isDay(to)) throw new BadRequest('Pick a start and end date');
  if (from > to) throw new BadRequest('The start date is after the end date');
  if (daysBetween(from, to) > MAX_RANGE_DAYS) throw new BadRequest('Pick at most a year');
  return { from, to };
}

// Text the owner typed: trimmed, single spaces, printable, within limits. '' → null (back to the default).
export function cleanText(v: unknown, max: number, what: string): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string') throw new BadRequest(`${what} must be text`);
  const s = v.replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim();
  if (s.length > max) throw new BadRequest(`${what} is too long (at most ${max} characters)`);
  return s || null;
}

export function cleanPrice(v: unknown, what: string, min = 1): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > 100000) throw new BadRequest(`${what} must be a whole number of rupees${min ? ' above 0' : ''}`);
  return v;
}
