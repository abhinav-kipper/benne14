'use client';
// What a screen shows instead of going blank when it hits an error it can't handle: "One moment",
// then it reloads itself. Nobody in the shop has a keyboard to press refresh. If it keeps failing
// (three times in a minute) it stops reloading and asks for staff, so it can't loop forever.
import { useEffect, useState } from 'react';

const KEY = 'benne14.crashes';
const TRIES = 3;
const WINDOW_MS = 60_000;
export const RELOAD_AFTER_MS = 4000;

export function Recover({ error }: { error: unknown }) {
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    console.error('screen crashed', error);
    let recent: number[] = [];
    try {
      recent = (JSON.parse(sessionStorage.getItem(KEY) ?? '[]') as number[]).filter((t) => Date.now() - t < WINDOW_MS);
      recent.push(Date.now());
      sessionStorage.setItem(KEY, JSON.stringify(recent));
    } catch {
      // storage unavailable: reload once and hope
    }
    if (recent.length >= TRIES) {
      setStuck(true);
      return;
    }
    const t = setTimeout(() => window.location.reload(), RELOAD_AFTER_MS);
    return () => clearTimeout(t);
  }, [error]);
  return (
    <div className="recover" data-testid="recover">
      <div className="logo">
        Benne <i>14</i>
      </div>
      <h1>{stuck ? 'This screen needs a hand' : 'One moment'}</h1>
      <p>{stuck ? 'Please tell the staff at the counter.' : 'This screen is starting again.'}</p>
      {stuck && (
        <button onClick={() => window.location.reload()} data-testid="recover-reload">
          Start again
        </button>
      )}
    </div>
  );
}
