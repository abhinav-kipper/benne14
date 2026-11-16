'use client';
// The kitchen screen's own hooks: sound and flash for new orders, the menu for photos and colours,
// and how many chits are out of view on the rail.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BASE_CATALOG, mergeCatalog, type Catalog, type MenuItem } from '@/lib/menu';
import { type Order } from '@/lib/orders';
import { api, chime } from '@/lib/client';

const SOUND_KEY = 'benne14.sound';

// Sound. The choice is remembered, but a browser only plays audio after a tap on the page, so after
// every reload a bar asks for one tap anywhere. New orders also flash the screen, sound or not.
export function useKitchenSound(orders: Order[] | null) {
  const audio = useRef<AudioContext | null>(null);
  const [wantSound, setWantSound] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const soundOn = wantSound && unlocked;
  useEffect(() => {
    setWantSound(localStorage.getItem(SOUND_KEY) === '1');
  }, []);
  const unlock = useCallback(() => {
    audio.current ??= new AudioContext();
    audio.current.resume();
    setUnlocked(true);
  }, []);
  useEffect(() => {
    if (!wantSound || unlocked) return;
    const tap = () => {
      unlock();
      chime(audio.current, [660]);
    };
    window.addEventListener('pointerdown', tap, { once: true });
    return () => window.removeEventListener('pointerdown', tap);
  }, [wantSound, unlocked, unlock]);
  const [flash, setFlash] = useState(0);
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!orders) return;
    // Chime + flash for new kitchen orders and for UPI "I've paid" claims the counter must check.
    const fresh = orders
      .filter((o) => o.status === 'new' || o.status === 'awaiting_cash')
      .map((o) => `${o.id}:${o.status}`);
    if (seen.current && fresh.some((id) => !seen.current!.has(id))) {
      if (soundOn) chime(audio.current);
      setFlash((n) => n + 1);
    }
    seen.current = new Set([...(seen.current ?? []), ...fresh]);
  }, [orders, soundOn]);
  const toggleSound = () => {
    if (wantSound) {
      localStorage.setItem(SOUND_KEY, '0');
      setWantSound(false);
      return;
    }
    localStorage.setItem(SOUND_KEY, '1');
    unlock();
    setWantSound(true);
    chime(audio.current, [660]);
  };
  return { wantSound, unlocked, toggleSound, flash };
}

// The whole menu, hidden dishes included: an order placed before a dish was hidden still shows its photo.
// Also the colours of the owner's own extras and notes.
export function useKitchenMenu(rail: Order[]) {
  const [dishes, setDishes] = useState<Map<string, MenuItem>>(new Map());
  const [menu, setMenu] = useState<Catalog>(BASE_CATALOG); // for the colours of the owner's own extras and notes
  const loadMenu = useCallback(
    () =>
      api
        .menu()
        .then((o) => {
          const all = mergeCatalog(o, true);
          setMenu(all);
          setDishes(new Map(all.items.map((i) => [i.id, i])));
        })
        .catch(() => {}),
    [],
  );
  useEffect(() => {
    loadMenu();
    const t = setInterval(loadMenu, 60_000);
    return () => clearInterval(t);
  }, [loadMenu]);
  // An order with a dish, extra or note this screen has not heard of (the owner just added it):
  // fetch the menu now, once per such thing, so the chit gets its photo and colours at once.
  const asked = useRef(new Set<string>());
  useEffect(() => {
    let fresh = false;
    for (const o of rail)
      for (const l of o.lines) {
        const unknown = [
          dishes.has(l.itemId) ? null : l.itemId,
          ...l.mods.map((m) =>
            menu.groups[m.groupId]?.options.some((x) => x.id === m.id) ? null : `${m.groupId}:${m.id}`,
          ),
          ...l.notes.map((n) => (menu.notes.some((x) => x.id === n.id) ? null : n.id)),
        ];
        for (const id of unknown)
          if (id && !asked.current.has(id)) {
            asked.current.add(id);
            fresh = true;
          }
      }
    if (fresh) loadMenu();
  }, [rail, dishes, menu, loadMenu]);
  return { dishes, menu };
}

// The rail scrolls sideways when it's full. Count the chits out of view on each side so a clear
// "+3 more ›" tab can say so: the newest orders land at the far right.
export function useRailOverflow(chits: number) {
  const railRef = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState({ left: 0, right: 0 });
  const countHidden = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    const view = el.getBoundingClientRect();
    let left = 0,
      right = 0;
    for (const c of el.querySelectorAll('.chit')) {
      const r = c.getBoundingClientRect();
      const mid = r.left + r.width / 2; // a chit counts as hidden once more than half of it is out of view
      if (mid < view.left) left++;
      else if (mid > view.right) right++;
    }
    setHidden((h) => (h.left === left && h.right === right ? h : { left, right }));
  }, []);
  useLayoutEffect(countHidden, [countHidden, chits]);
  const scrollRail = (dir: 1 | -1) =>
    railRef.current?.scrollBy({ left: dir * railRef.current.clientWidth * 0.8, behavior: 'smooth' });
  return { railRef, hidden, countHidden, scrollRail };
}
