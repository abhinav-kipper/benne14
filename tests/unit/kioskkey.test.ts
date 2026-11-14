import { describe, expect, it } from 'vitest';
import { checkKioskKey, makeKioskKey } from '@/lib/kioskkey';

describe('the kiosk’s key', () => {
  const key = makeKioskKey('2468', 'db-secret');
  it('is accepted by the server that made it', () => {
    expect(key).toMatch(/^k1\.[A-Za-z0-9_-]{6,24}\.[A-Za-z0-9_-]{32}$/);
    expect(checkKioskKey(key, '2468', 'db-secret')).toBe(true);
    expect(makeKioskKey('2468', 'db-secret')).not.toBe(key); // every tablet gets its own
  });
  it('stops working when the staff PIN or the database key changes', () => {
    expect(checkKioskKey(key, '1357', 'db-secret')).toBe(false);
    expect(checkKioskKey(key, '2468', 'another-secret')).toBe(false);
  });
  it('refuses anything that is not a key it signed', () => {
    const [v, id, sig] = key.split('.');
    const flipped = sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A');
    for (const bad of [
      `${v}.${id}.${flipped}`,
      `${v}.other${id}.${sig}`,
      `k2.${id}.${sig}`,
      'k1..',
      '',
      'x'.repeat(500),
      null,
      7,
      {},
    ])
      expect(checkKioskKey(bad, '2468', 'db-secret'), String(bad)).toBe(false);
    expect(checkKioskKey(key, '', 'db-secret')).toBe(false); // no PIN configured: nothing is a kiosk
  });
});
