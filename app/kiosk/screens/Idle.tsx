'use client';
// "Still there?": shown after a while without a touch; goes back to the start if nobody answers.
import { useEffect, useState } from 'react';
import { IDLE_GRACE_S } from './shared';

export function Idle({
  onStay,
  onReset,
  seconds = IDLE_GRACE_S,
  text = (left) => `Still ordering? We'll start a fresh order in ${left} seconds.`,
  stay = "Yes, I'm here",
  leave = 'Start over',
}: {
  onStay: () => void;
  onReset: () => void;
  seconds?: number;
  text?: (left: number) => string;
  stay?: string;
  leave?: string;
}) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    const t = setInterval(() => setLeft((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (left <= 0) onReset();
  }, [left, onReset]);
  return (
    <div className="k-idle" data-testid="still-there">
      <div className="box">
        <h2 className="disp">Still there?</h2>
        <p>{text(Math.max(0, left))}</p>
        <div className="btns">
          <button className="no" onClick={onReset}>
            {leave}
          </button>
          <button className="yes" onClick={onStay}>
            {stay}
          </button>
        </div>
      </div>
    </div>
  );
}
