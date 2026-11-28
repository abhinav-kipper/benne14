'use client';
// A device that has used one of the shop's screens before (an app installed from the plain address,
// an old bookmark) is sent straight back to it. Anyone else is told there is nothing here.
import { useEffect, useState } from 'react';
import { SCREEN_KEY, SCREEN_PATH } from '@/lib/client';

export function Landing() {
  const [nothing, setNothing] = useState(false);
  useEffect(() => {
    let to: string | undefined;
    try {
      to = SCREEN_PATH[localStorage.getItem(SCREEN_KEY) ?? ''];
    } catch {
      // no storage: treated as a stranger
    }
    if (to) window.location.replace(to);
    else setNothing(true);
  }, []);
  if (!nothing) return null;
  return (
    <main
      style={{ maxWidth: 560, margin: '0 auto', padding: '96px 20px', textAlign: 'center' }}
      data-testid="nothing-here"
    >
      <h1 className="disp" style={{ fontSize: 44, lineHeight: 0.9 }}>
        Page not found
      </h1>
      <p style={{ color: 'var(--cream-3)', marginTop: 12 }}>There is nothing at this address.</p>
    </main>
  );
}
