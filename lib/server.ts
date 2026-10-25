// Small helpers for API route handlers.
import 'server-only';
import { NextResponse } from 'next/server';
import { OrderError } from './pricing';
import { StoreError } from './store/memory';

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export function fail(e: unknown) {
  if (e instanceof OrderError) return json({ error: e.message }, 400);
  if (e instanceof StoreError) return json({ error: e.message }, e.status);
  console.error(e);
  return json({ error: 'Something went wrong' }, 500);
}

// Staff actions (kitchen, counter) need the shop PIN. In production STAFF_PIN must be set;
// for local demos on the in-memory store it falls back to 1414.
export function staffOk(req: Request): boolean {
  const pin = process.env.STAFF_PIN ?? (process.env.NODE_ENV === 'production' ? undefined : '1414');
  return !!pin && req.headers.get('x-staff-pin') === pin;
}

// v1 takes no real money: the mock provider "confirms" payments when asked.
export const paymentsAreMock = () => (process.env.PAYMENTS ?? 'mock') === 'mock';
