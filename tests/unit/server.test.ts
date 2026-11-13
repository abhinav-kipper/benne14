import { afterEach, describe, expect, it, vi } from 'vitest';
import { BadRequest, isOrderId, readJson, staffCheck, staffOk } from '@/lib/server';
import { FailureLimiter } from '@/lib/ratelimit';

const req = (body: string, headers: Record<string, string> = {}) => new Request('http://x/api', { method: 'POST', body, headers });

describe('request helpers', () => {
  it('reads a JSON object and refuses anything else as a bad request', async () => {
    expect(await readJson(req('{"a":1}'))).toEqual({ a: 1 });
    for (const bad of ['{bad', '', 'null', '[]', '"text"', '42']) await expect(readJson(req(bad))).rejects.toBeInstanceOf(BadRequest);
  });

  it('recognises order ids', () => {
    expect(isOrderId('313d4a28-324e-431f-b94e-b56fde785ea2')).toBe(true);
    for (const bad of ['abc', '', '313d4a28-324e-431f-b94e-b56fde785ea2x', "1' or '1'='1", '../../etc/passwd']) expect(isOrderId(bad)).toBe(false);
  });
});

describe('staff PIN', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('matches the PIN, ignoring stray spaces in the env value or header', () => {
    vi.stubEnv('STAFF_PIN', ' 4321\n');
    expect(staffOk(req('', { 'x-staff-pin': '4321' }))).toBe(true);
    expect(staffOk(req('', { 'x-staff-pin': ' 4321 ' }))).toBe(true);
    expect(staffOk(req('', { 'x-staff-pin': '1234' }))).toBe(false);
    expect(staffOk(req(''))).toBe(false);
  });

  it('refuses everyone in production when no PIN is set', () => {
    vi.stubEnv('STAFF_PIN', undefined as unknown as string);
    vi.stubEnv('NODE_ENV', 'production');
    expect(staffOk(req('', { 'x-staff-pin': '1414' }))).toBe(false);
    expect(staffOk(req('', { 'x-staff-pin': '' }))).toBe(false);
  });

  it('locks an address out after 30 wrong PINs, without affecting others', () => {
    vi.stubEnv('STAFF_PIN', '4321');
    const from = (ip: string, pin: string) => req('', { 'x-staff-pin': pin, 'x-forwarded-for': `${ip}, 10.0.0.1` });
    for (let i = 0; i < 30; i++) expect(staffCheck(from('9.9.9.9', String(1000 + i)))).toBe('bad');
    expect(staffCheck(from('9.9.9.9', '4321'))).toBe('locked'); // even the right PIN, until the window passes
    expect(staffCheck(from('8.8.8.8', '4321'))).toBe('ok');
  });
});

describe('failure limiter', () => {
  it('forgets failures once the window has passed', () => {
    let t = 0;
    const l = new FailureLimiter(3, 1000, () => t);
    l.fail('a'); l.fail('a'); l.fail('a');
    expect(l.locked('a')).toBe(true);
    t = 1001;
    expect(l.locked('a')).toBe(false);
  });
});
