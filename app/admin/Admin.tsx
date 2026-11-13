'use client';
// Owner dashboard (phone). Design: prototype/admin.html. Behind the staff PIN until the owner gets a
// login. This file holds the PIN gate and the tabs; each tab's screen lives in ./screens.
import { useCallback, useEffect, useState } from 'react';
import { PinGate, PIN_KEY } from '@/components/PinGate';
import { ApiError, useLiveOrders } from '@/lib/client';
import { History } from './screens/History';
import { Menu } from './screens/Menu';
import { Orders } from './screens/Orders';
import { Reports } from './screens/Reports';
import type { Tab } from './screens/shared';
import { Today } from './screens/Today';

export default function Admin() {
  const [pin, setPin] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('today');
  useEffect(() => {
    setPin(localStorage.getItem(PIN_KEY));
    setReady(true);
  }, []);
  // A PIN the server stops accepting (changed in Vercel) sends the owner back to the PIN pad.
  const onAuthError = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.status === 401) {
      localStorage.removeItem(PIN_KEY);
      setNote('The PIN was changed. Enter the new PIN.');
      setPin(null);
    }
  }, []);
  const live = useLiveOrders(5000);
  const toConfirm = (live.orders ?? []).filter((o) => o.status === 'awaiting_cash').length;

  if (!ready) return null;
  if (!pin)
    return (
      <div className="adm">
        <PinGate
          title="Owner"
          note={note}
          onPin={(p) => {
            localStorage.setItem(PIN_KEY, p);
            setNote(null);
            setPin(p);
          }}
        />
      </div>
    );
  const ctx = { pin, onAuthError };
  return (
    <div className="adm">
      {tab === 'today' && <Today {...ctx} live={live.orders ?? []} refreshLive={live.refresh} go={setTab} />}
      {tab === 'orders' && <Orders {...ctx} refreshLive={live.refresh} />}
      {tab === 'menu' && <Menu {...ctx} openHistory={() => setTab('history')} />}
      {tab === 'reports' && <Reports {...ctx} />}
      {tab === 'history' && <History {...ctx} back={() => setTab('menu')} />}
      <nav className="tabs">
        {(['today', 'orders', 'menu', 'reports'] as const).map((t) => (
          <button
            key={t}
            className={tab === t || (t === 'menu' && tab === 'history') ? 'on' : ''}
            onClick={() => setTab(t)}
            data-testid={`tab-${t}`}
          >
            {ICONS[t]}
            {t[0].toUpperCase() + t.slice(1)}
            {t === 'orders' && toConfirm > 0 && <span className="dot">{toConfirm}</span>}
          </button>
        ))}
      </nav>
    </div>
  );
}

const ICONS: Record<'today' | 'orders' | 'menu' | 'reports', React.ReactNode> = {
  today: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 4h14v16l-2.3-1.5L14.3 20 12 18.5 9.7 20l-2.4-1.5L5 20z" />
      <path d="M9 9h6M9 13h4" />
    </svg>
  ),
  orders: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M8 6h12M8 12h12M8 18h12" />
      <circle cx="4" cy="6" r="1" fill="currentColor" />
      <circle cx="4" cy="12" r="1" fill="currentColor" />
      <circle cx="4" cy="18" r="1" fill="currentColor" />
    </svg>
  ),
  menu: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="13" r="7" />
      <circle cx="12" cy="13" r="3.5" />
      <path d="M12 3v3" />
    </svg>
  ),
  reports: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M5 20V11M10 20V5M15 20v-7M20 20V9" />
    </svg>
  ),
};
