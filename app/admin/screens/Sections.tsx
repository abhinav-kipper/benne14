'use client';
// The menu's sections: add one, rename, drag into a new order, switch a whole section off the kiosk.
import { useRef, useState } from 'react';
import { admin, ApiError } from '@/lib/client';
import { TEST_CAT, type Catalog, type Category } from '@/lib/menu';
import type { Ctx } from './shared';

export function SectionsSheet(p: Ctx & { cat: Catalog; close: () => void; changed: () => Promise<unknown> }) {
  const [rows, setRows] = useState<Category[]>(() => p.cat.cats.filter((c) => c.id !== TEST_CAT));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const count = (id: string) => p.cat.items.filter((i) => i.cat === id && !i.hidden && !i.draft).length;
  const total = (id: string) => p.cat.items.filter((i) => i.cat === id).length;

  // One change, then the list as the server now has it.
  const run = async (b: Parameters<typeof admin.menuChange>[1], then?: (rows: Category[]) => Category[]) => {
    setBusy(true);
    setErr(null);
    try {
      const r = (await admin.menuChange(p.pin, b)) as { section?: { id: string; name: string } };
      if (then) setRows(then);
      await p.changed();
      setBusy(false);
      return r;
    } catch (e) {
      p.onAuthError(e);
      setErr(e instanceof ApiError ? e.message : 'Not saved: no internet.');
      setBusy(false);
      return null;
    }
  };
  const add = async () => {
    const name = fresh.trim();
    if (!name) return setErr('Give the section a name');
    const r = await run({ section: { name } });
    if (r?.section) {
      setRows((cur) => [...cur, { ...r.section!, custom: true }]);
      setFresh('');
    }
  };
  const rename = async () => {
    if (!renaming) return;
    const name = renaming.name.trim();
    if (!name) return setErr('The section needs a name');
    const r = await run({ section: { id: renaming.id, name } }, (cur) =>
      cur.map((c) => (c.id === renaming.id ? { ...c, name } : c)),
    );
    if (r) setRenaming(null);
  };
  const toggle = (c: Category) =>
    run(c.hidden ? { showSection: c.id } : { hideSection: c.id }, (cur) =>
      cur.map((x) => (x.id === c.id ? { ...x, hidden: !c.hidden } : x)),
    );

  // Drag a row by its dots; letting go saves the order.
  const grip = useRef<{ id: string; y: number; h: number } | null>(null);
  const [held, setHeld] = useState<string | null>(null);
  const order = useRef(rows);
  order.current = rows;
  const dragMove = (e: React.PointerEvent<HTMLElement>) => {
    const g = grip.current;
    if (!g) return;
    const step = Math.trunc((e.clientY - g.y) / (g.h * 0.6));
    if (!step) return;
    const dir = step > 0 ? 1 : -1;
    setRows((cur) => {
      const at = cur.findIndex((x) => x.id === g.id);
      const to = at + dir;
      if (to < 0 || to >= cur.length) return cur;
      const next = [...cur];
      next.splice(to, 0, next.splice(at, 1)[0]);
      return next;
    });
    g.y += dir * g.h;
  };
  const dragEnd = () => {
    if (!grip.current) return;
    grip.current = null;
    setHeld(null);
    // after React has applied the last move
    setTimeout(() => run({ sectionOrder: order.current.map((c) => c.id) }), 0);
  };

  return (
    <>
      <div className="scrim" onClick={p.close} />
      <div className="sheet" data-testid="sections-sheet">
        <div className="grab" />
        <div className="hd">
          <div>
            <span className="eyebrow">Menu</span>
            <div className="disp ttl">Sections</div>
          </div>
        </div>
        <div className="was">
          The kiosk lists sections in this order. Switch one off to take it and its dishes off the kiosk. Tap a name to
          change it; hold the dots to move it.
        </div>
        <div className="secs">
          {rows.map((c) => (
            <div
              className={`sec ${c.hidden ? 'off' : ''} ${held === c.id ? 'held' : ''}`}
              key={c.id}
              data-testid={`sec-${c.id}`}
              data-section={c.name}
            >
              <span
                className="grip"
                role="button"
                aria-label={`Move ${c.name}`}
                onPointerDown={(e) => {
                  const row = e.currentTarget.closest('.sec') as HTMLElement;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  grip.current = { id: c.id, y: e.clientY, h: row.offsetHeight };
                  setHeld(c.id);
                }}
                onPointerMove={dragMove}
                onPointerUp={dragEnd}
                onPointerCancel={dragEnd}
                data-testid={`sec-grip-${c.id}`}
              >
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
              </span>
              {renaming?.id === c.id ? (
                <div className="ren">
                  <input
                    className="in"
                    autoFocus
                    maxLength={24}
                    value={renaming.name}
                    onChange={(e) => setRenaming({ id: c.id, name: e.target.value })}
                    onKeyDown={(e) => e.key === 'Enter' && rename()}
                    data-testid="sec-rename"
                  />
                  <button className="link" disabled={busy} onClick={rename} data-testid="sec-rename-save">
                    Save
                  </button>
                </div>
              ) : (
                <button className="nm" onClick={() => setRenaming({ id: c.id, name: c.name })}>
                  <b>{c.name}</b>
                  <small>
                    {count(c.id)} {count(c.id) === 1 ? 'dish' : 'dishes'}
                    {c.hidden ? ' · off the kiosk' : ''}
                  </small>
                </button>
              )}
              {c.custom && total(c.id) === 0 && renaming?.id !== c.id && (
                <button
                  className="link rm"
                  disabled={busy}
                  onClick={() => run({ removeSection: c.id }, (cur) => cur.filter((x) => x.id !== c.id))}
                  data-testid={`sec-remove-${c.id}`}
                >
                  Remove
                </button>
              )}
              <button
                className={`sw ${c.hidden ? 'off' : ''}`}
                role="switch"
                aria-checked={!c.hidden}
                aria-label={`${c.name} on the kiosk`}
                disabled={busy}
                onClick={() => toggle(c)}
                data-testid={`sec-sw-${c.id}`}
              >
                <span className="swlbl">{c.hidden ? 'Off' : 'On'}</span>
              </button>
            </div>
          ))}
        </div>
        <div className="field">
          <label htmlFor="sec-new">New section</label>
          <div className="newsec">
            <input
              id="sec-new"
              className="in"
              placeholder="e.g. Sweets"
              maxLength={24}
              value={fresh}
              onChange={(e) => setFresh(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
              data-testid="sec-new"
            />
            <button className="btn y" disabled={busy} onClick={add} data-testid="sec-add">
              Add
            </button>
          </div>
          <div className="was">
            A new section shows on the kiosk once it has a dish. Add dishes to it from the menu.
          </div>
        </div>
        {err && (
          <div className="err" data-testid="sec-err">
            {err}
          </div>
        )}
        <div className="actions">
          <button className="btn o" onClick={p.close} data-testid="sec-done">
            Done
          </button>
        </div>
      </div>
    </>
  );
}
