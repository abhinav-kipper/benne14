'use client';
// "Still there?": shown after a while without a touch; starts over if nobody answers.
import { useEffect, useState } from 'react';
import { IDLE_GRACE_S } from './shared';

export function Idle({ onStay, onReset }: { onStay: () => void; onReset: () => void }) {
  const [left, setLeft] = useState(IDLE_GRACE_S);
  useEffect(() => {
    const t = setInterval(() => setLeft((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (left <= 0) onReset();
  }, [left, onReset]);
  return (
    <div className="k-idle">
      <div className="box">
        <h2 className="disp">Still there?</h2>
        <p>Still ordering? We&apos;ll start a fresh order in {Math.max(0, left)} seconds.</p>
        <div className="btns">
          <button className="no" onClick={onReset}>
            Start over
          </button>
          <button className="yes" onClick={onStay}>
            Yes, I&apos;m here
          </button>
        </div>
      </div>
    </div>
  );
}
