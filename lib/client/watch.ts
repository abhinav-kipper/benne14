'use client';
// Telling the owner app this screen is alive, and what goes wrong on it.
import { useEffect, useRef } from 'react';
import { BEAT_MS } from '../system';
import { BUILD_ID } from '../version';
import { usePoll } from './poll';

const DEVICE_KEY = 'benne14.device';
function deviceId(): string | null {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id || !/^[a-z0-9]{8,24}$/.test(id)) {
      id =
        Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => (b % 36).toString(36)).join('') +
        Date.now().toString(36);
      id = id.slice(0, 20);
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return null; // no storage: this screen goes unlisted, and works all the same
  }
}

// Send one error report. Never throws, never waits, and a screen stuck in a loop of errors sends
// only a few: the first ones say what is wrong.
let reported = 0;
export function reportError(source: 'kiosk' | 'kitchen' | 'board' | 'owner' | 'bill', error: unknown, where = '') {
  if (++reported > 5) return;
  try {
    const e = error instanceof Error ? error : new Error(typeof error === 'string' ? error : JSON.stringify(error));
    void fetch('/api/log', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source,
        message: `${where ? `${where}: ` : ''}${e.message}`.slice(0, 300),
        detail: (e.stack ?? '').slice(0, 2000),
        build: BUILD_ID,
        device: deviceId(),
      }),
    }).catch(() => {});
  } catch {
    // reporting must never be what breaks the screen
  }
}

// One line per screen: say "I'm here" every half minute (which screen, what it is showing, its
// version) and report any error the screen did not handle itself.
export function useWatch(kind: 'kiosk' | 'kitchen' | 'board' | 'owner', screen = '') {
  const showing = useRef(screen);
  showing.current = screen;
  usePoll(async () => {
    const id = deviceId();
    if (!id) return;
    await fetch('/api/beat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, kind, screen: showing.current, build: BUILD_ID }),
      signal: AbortSignal.timeout(8000),
    }).catch(() => {});
  }, BEAT_MS);
  useEffect(() => {
    const onError = (e: ErrorEvent) => reportError(kind, e.error ?? e.message, showing.current);
    const onReject = (e: PromiseRejectionEvent) => reportError(kind, e.reason, showing.current);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onReject);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onReject);
    };
  }, [kind]);
}
