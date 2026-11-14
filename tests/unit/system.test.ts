import { describe, expect, it } from 'vitest';
import {
  ago,
  clip,
  isDeviceId,
  isOnline,
  problems,
  type Device,
  type ErrorEntry,
  type SystemInput,
} from '@/lib/system';

const NOW = Date.parse('2026-11-14T10:00:00Z');
const at = (minsAgo: number) => new Date(NOW - minsAgo * 60_000).toISOString();
const dev = (kind: Device['kind'], seenMinsAgo: number, over: Partial<Device> = {}): Device => ({
  id: `${kind}00000001`,
  kind,
  screen: null,
  build: 'v2',
  firstSeen: at(600),
  seenAt: at(seenMinsAgo),
  ...over,
});
const err = (minsAgo: number, source: ErrorEntry['source'] = 'kiosk'): ErrorEntry => ({
  at: at(minsAgo),
  source,
  message: 'boom',
  detail: null,
  build: 'v2',
  device: null,
});
const input = (over: Partial<SystemInput> = {}): SystemInput => ({
  now: NOW,
  open: true,
  build: 'v2',
  devices: [dev('kiosk', 0), dev('kitchen', 0), dev('board', 0)],
  errors: [],
  missingMigrations: [],
  testMode: false,
  payments: [],
  ...over,
});

describe('system page: what needs the owner’s eye', () => {
  it('says nothing when every screen is answering', () => {
    expect(problems(input())).toEqual([]);
  });

  it('a screen silent for two minutes during opening hours is a problem; the TV less urgent than kiosk and kitchen', () => {
    expect(isOnline(dev('kiosk', 1), NOW)).toBe(true);
    expect(isOnline(dev('kiosk', 3), NOW)).toBe(false);
    const p = problems(input({ devices: [dev('kiosk', 5), dev('kitchen', 0), dev('board', 9)] }));
    expect(p.map((x) => [x.level, x.text])).toEqual([
      ['bad', 'Kiosk has been silent since 5 min ago'],
      ['warn', 'TV board has been silent since 9 min ago'],
    ]);
    expect(p[0].hint).toContain('Wi-Fi');
  });

  it('a silent screen after closing time is not a problem, and a screen never connected is not a fault', () => {
    expect(problems(input({ open: false, devices: [dev('kiosk', 300)] }))).toEqual([]);
    expect(problems(input({ devices: [dev('kitchen', 0)] }))).toEqual([]);
  });

  it('two kiosks: one still answering means the kiosk is not down', () => {
    const two = [dev('kiosk', 30), dev('kiosk', 0, { id: 'kiosk00000002' }), dev('kitchen', 0), dev('board', 0)];
    expect(problems(input({ devices: two }))).toEqual([]);
  });

  it('flags a screen stuck on an old version, but not one that has only just connected', () => {
    const old = problems(input({ devices: [dev('kiosk', 0, { build: 'v1' }), dev('kitchen', 0), dev('board', 0)] }));
    expect(old).toEqual([expect.objectContaining({ level: 'warn', text: 'Kiosk is on an old version' })]);
    const fresh = [dev('kiosk', 0, { build: 'v1', firstSeen: at(2) }), dev('kitchen', 0), dev('board', 0)];
    expect(problems(input({ devices: fresh }))).toEqual([]);
  });

  it('three errors in fifteen minutes is worth a look; server errors make it urgent; old ones do not count', () => {
    expect(problems(input({ errors: [err(1), err(20), err(40)] }))).toEqual([]);
    expect(problems(input({ errors: [err(1), err(5), err(9)] }))[0]).toMatchObject({ level: 'warn' });
    expect(problems(input({ errors: [err(1, 'server'), err(5), err(9)] }))[0]).toMatchObject({
      level: 'bad',
      text: '3 errors in the last 15 minutes',
    });
  });

  it('a payment flagged in the last day comes first; test mode and a missing database update are listed', () => {
    const p = problems(
      input({
        testMode: true,
        missingMigrations: ['0012_system_watch'],
        payments: [
          { at: at(30), subject: 'Order 42', note: 'Paid ₹219 after the order was cancelled' },
          { at: at(60 * 30), subject: 'Order 7' },
        ],
      }),
    );
    expect(p.map((x) => x.level)).toEqual(['bad', 'warn', 'info']);
    expect(p[0]).toMatchObject({
      text: 'Payment needs a look: Order 42',
      hint: 'Paid ₹219 after the order was cancelled',
    });
    expect(p[1].hint).toContain('0012_system_watch');
  });
});

describe('system page: small helpers', () => {
  it('says how long ago in words', () => {
    expect(ago(at(0.2), NOW)).toBe('just now');
    expect(ago(at(12), NOW)).toBe('12 min ago');
    expect(ago(at(60 * 5), NOW)).toBe('5 h ago');
    expect(ago(at(60 * 24 * 3), NOW)).toBe('3 days ago');
  });
  it('accepts only ids a screen makes for itself', () => {
    expect(isDeviceId('k3j2h1g0f9e8')).toBe(true);
    for (const bad of ['short', 'UPPERCASE12', "abc'; drop table", 'x'.repeat(25), 7, null])
      expect(isDeviceId(bad)).toBe(false);
  });
  it('clips what a screen reports to a short printable text', () => {
    expect(clip('  hello\u0000\u0007 world  ', 300)).toBe('hello world');
    expect(clip('x'.repeat(500), 300)).toHaveLength(300);
    expect(clip(undefined, 10)).toBe('');
    expect(clip({ a: 1 }, 30)).toBe('[object Object]');
  });
});
