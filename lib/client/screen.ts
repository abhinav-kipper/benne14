'use client';
// Screens that look after themselves (docs/go-live.md stage 2): reload after a deploy and at night,
// stay awake, know when the server is unreachable, restart on a long press of the logo.
import { useCallback, useEffect, useRef, useState } from 'react';
import { BUILD_ID } from '../version';
import { call } from './http';
import { usePoll } from './poll';

// After a deploy, open screens are still running the old code. This asks the server once a minute
// which build it runs and reloads the page when it differs, but only while `safe` is true (the
// kiosk passes "on the start screen", so a customer's order is never interrupted).
export function useAutoReload(safe = true) {
  const target = useRef<string | null>(null);
  usePoll(async () => {
    const { build } = await call<{ build: string }>('/api/version');
    if (build && build !== BUILD_ID) target.current = build;
  }, 60_000);
  const maybeReload = useCallback(() => {
    const to = target.current;
    if (!to) return;
    // Reload once per new build. If the page still isn't on that build afterwards (a misconfigured
    // build id), it must not reload again and again: remember which build we already reloaded for.
    try {
      if (sessionStorage.getItem(RELOADED_FOR) === to) return;
      sessionStorage.setItem(RELOADED_FOR, to);
    } catch {
      return;
    }
    window.location.reload();
  }, []);
  useEffect(() => {
    if (safe) maybeReload();
  });
  // also check at the moment it becomes safe, between two polls
  useEffect(() => {
    if (!safe) return;
    const t = setInterval(maybeReload, 5000);
    return () => clearInterval(t);
  }, [safe, maybeReload]);
}
const RELOADED_FOR = 'benne14.reloadedFor';

// A short two-note chime made in the browser (no audio files). Browsers only allow sound after a tap.
export function chime(ctx: AudioContext | null, notes = [880, 1320]) {
  if (!ctx) return;
  notes.forEach((f, i) => {
    const o = ctx.createOscillator(),
      g = ctx.createGain();
    o.frequency.value = f;
    o.type = 'sine';
    const t = ctx.currentTime + i * 0.16;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.55);
  });
}

// Can the shop take an order right now (server reachable, database answering)? Asked every 10 s.
// One failed answer can be a blip; two in a row means down. The first good answer means up again.
export function useServerUp(on = true) {
  const [up, setUp] = useState(true);
  const fails = useRef(0);
  usePoll(
    async () => {
      try {
        await call<{ ok: boolean }>('/api/ping', { timeoutMs: 6000 });
        fails.current = 0;
        setUp(true);
      } catch {
        if (++fails.current >= 2) setUp(false);
        return false;
      }
    },
    10_000,
    on,
  );
  return up;
}

// Keep the screen on: a kiosk, kitchen display or TV that dims or sleeps is a screen out of service.
// The browser drops the lock whenever the page is hidden, so it is asked for again each time it shows.
export function useAwake() {
  useEffect(() => {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<unknown> } };
    const hold = () => {
      if (!document.hidden) nav.wakeLock?.request('screen').catch(() => {});
    };
    hold();
    document.addEventListener('visibilitychange', hold);
    return () => document.removeEventListener('visibilitychange', hold);
  }, []);
}

// Start fresh once a night: a browser left running for weeks slows down and collects odd state.
// Between 4 and 5 am, once per night, and only when `safe` (nobody is in the middle of anything).
const NIGHTLY = 'benne14.nightly';
export function useNightlyReload(safe = true) {
  const ok = useRef(safe);
  ok.current = safe;
  useEffect(() => {
    const t = setInterval(() => {
      const now = new Date();
      if (now.getHours() !== 4 || !ok.current) return;
      const night = now.toDateString();
      try {
        if (sessionStorage.getItem(NIGHTLY) === night) return;
        sessionStorage.setItem(NIGHTLY, night);
      } catch {
        return;
      }
      window.location.reload();
    }, 60_000);
    return () => clearInterval(t);
  }, []);
}

// Staff's way to unstick a screen with no keyboard: hold the logo for five seconds and it reloads.
const HOLD_RELOAD_MS = 5000;
export function useHoldToReload() {
  const t = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stop = useCallback(() => clearTimeout(t.current), []);
  useEffect(() => stop, [stop]);
  return {
    onPointerDown: () => {
      stop();
      t.current = setTimeout(() => window.location.reload(), HOLD_RELOAD_MS);
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  };
}
