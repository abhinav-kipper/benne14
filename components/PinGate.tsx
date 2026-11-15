'use client';
// PIN pad, checked with the server as soon as the last digit is typed. The kitchen and the kiosk's
// one-time set-up take the staff PIN; the owner app takes the owner PIN (six digits once it is set).
import { useState } from 'react';
import { api, ApiError } from '@/lib/client';

export const PIN_KEY = 'benne14.staffPin';
export const OWNER_PIN_KEY = 'benne14.ownerPin';

export function PinGate({
  onPin,
  note,
  title,
  who = 'staff',
  digits = 4,
  ask,
}: {
  onPin: (p: string) => void;
  note: string | null;
  title: string;
  who?: 'staff' | 'owner';
  digits?: number;
  ask?: string; // the line under the title
}) {
  const [v, setV] = useState('');
  const [msg, setMsg] = useState<string | null>(note);
  const [busy, setBusy] = useState(false);
  const check = async (p: string) => {
    setBusy(true);
    try {
      await api.checkPin(p, who);
      onPin(p);
    } catch (e) {
      setMsg(
        e instanceof ApiError && e.status === 401
          ? 'Wrong PIN. Try again.'
          : e instanceof ApiError && e.status === 429
            ? e.message
            : 'No internet. Try again.',
      );
      setV('');
    } finally {
      setBusy(false);
    }
  };
  const press = (d: string) => {
    if (busy) return;
    setMsg(null);
    const n = d === '⌫' ? v.slice(0, -1) : (v + d).slice(0, digits);
    setV(n);
    if (n.length === digits && v.length === digits - 1) check(n);
  };
  return (
    <div className="pin" data-testid="pin-gate">
      <div className="box">
        <h2 className="disp">{title}</h2>
        <p>{ask ?? (who === 'owner' ? 'Enter the owner PIN' : 'Enter the staff PIN')}</p>
        <div className="dots">
          {Array.from({ length: digits }, (_, i) => i).map((i) => (
            <i key={i} className={i < v.length ? 'f' : ''} />
          ))}
        </div>
        <div className="pad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((d, i) =>
            d ? (
              <button key={i} onClick={() => press(d)} disabled={busy}>
                {d}
              </button>
            ) : (
              <span key={i} />
            ),
          )}
        </div>
        <div className="bad" data-testid="pin-msg">
          {busy ? 'Checking…' : msg}
        </div>
      </div>
    </div>
  );
}
