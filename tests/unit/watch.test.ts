import { describe, expect, it } from 'vitest';
import { vapid } from '@/lib/push';
import { MemoryStore } from '@/lib/store/memory';
import { alertChanges, isPushEndpoint, worthAPush, type Problem } from '@/lib/system';
import { watch } from '@/lib/watch';

const prob = (key: string, level: Problem['level'] = 'bad'): Problem => ({ key, level, text: key });
const phone = (n: number) => ({
  endpoint: `https://phone${n}.push.invalid/abc`,
  p256dh: 'p'.repeat(40),
  auth: 'a'.repeat(20),
});
const serverErrors = async (s: MemoryStore, n: number) => {
  for (let i = 0; i < n; i++)
    await s.logError({ source: 'server', message: `boom ${i}`, detail: null, build: 'v', device: null });
};

describe('alerts to the owner’s phone', () => {
  it('wakes the phone for what may be losing orders or money, and for a silent screen, not for housekeeping', () => {
    expect(worthAPush(prob('pay:2026', 'bad'))).toBe(true);
    expect(worthAPush(prob('silent:board', 'warn'))).toBe(true);
    expect(worthAPush(prob('old:kiosk', 'warn'))).toBe(false);
    expect(worthAPush(prob('test', 'info'))).toBe(false);
  });

  it('knows what is new and what has gone since the last check', () => {
    const c = alertChanges([prob('silent:kiosk'), prob('errors')], [{ key: 'errors' }, { key: 'pay:1' }]);
    expect(c.fresh.map((p) => p.key)).toEqual(['silent:kiosk']);
    expect(c.gone).toEqual(['pay:1']);
  });

  it('announces a problem once, to every phone, and not again while it lasts', async () => {
    const s = new MemoryStore();
    await s.saveSub(phone(1));
    await s.saveSub(phone(2));
    expect(await watch(s)).toMatchObject({ fresh: 0, pushed: 0 }); // nothing wrong, nothing sent
    await serverErrors(s, 3);
    expect(await watch(s)).toMatchObject({ fresh: 1, pushed: 2 });
    expect(await watch(s)).toMatchObject({ fresh: 0, pushed: 0 });
    const open = (await s.listAlerts()).filter((a) => !a.clearedAt);
    expect(open).toEqual([
      expect.objectContaining({ key: 'errors', level: 'bad', text: '3 errors in the last 15 minutes' }),
    ]);
  });

  it('two servers noticing the same problem open one alert between them', async () => {
    const s = new MemoryStore();
    const a = { key: 'silent:kiosk', level: 'bad' as const, text: 'Kiosk has been silent', hint: null };
    expect(await s.openAlert(a)).toBe(true);
    expect(await s.openAlert(a)).toBe(false);
    await s.clearAlerts(['silent:kiosk']);
    expect((await s.listAlerts())[0].clearedAt).not.toBeNull();
    expect(await s.openAlert(a)).toBe(true); // it came back: that is news again
  });

  it('with no phone subscribed the alert is still recorded for the System page', async () => {
    const s = new MemoryStore();
    await serverErrors(s, 3);
    expect(await watch(s)).toMatchObject({ fresh: 1, pushed: 0 });
    expect(await s.listAlerts()).toHaveLength(1);
  });

  it('makes its signing keys once and keeps them', async () => {
    const s = new MemoryStore();
    const k = await vapid(s);
    expect(k.publicKey.length).toBeGreaterThan(80);
    expect(JSON.parse((await s.getKey('vapid'))!).privateKey).toBe(k.privateKey);
    expect(await s.setKeyOnce('vapid', 'something else')).toContain(k.publicKey); // the first value stays
  });

  it('sends only to real push services, never to an address somebody made up', () => {
    for (const ok of [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/abc',
      'https://db5p.notify.windows.com/w/?token=abc',
      'https://phone1.push.invalid/abc',
    ])
      expect(isPushEndpoint(ok), ok).toBe(true);
    for (const bad of [
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://evil.example/fcm.googleapis.com',
      'https://fcm.googleapis.com.evil.example/x',
      'https://localhost/x',
      'https://169.254.169.254/latest/meta-data',
      'not a url',
      7,
      null,
    ])
      expect(isPushEndpoint(bad), String(bad)).toBe(false);
  });
});
