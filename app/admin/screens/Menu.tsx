'use client';
// The menu as the kiosk shows it: sold-out switches, and a sheet to edit price, name, description and extras.
import { useCallback, useEffect, useRef, useState } from 'react';
import { admin, ApiError } from '@/lib/client';
import { TEST_CAT, mergeCatalog, photoFor, placeholderFor, type Catalog, type MenuItem } from '@/lib/menu';
import { SectionsSheet } from './Sections';
import { Check, DishSheet, HideButton, SetPicker } from './Dish';
import { ExtrasSheet } from './Extras';
import { Bar, type Ctx } from './shared';

export function Menu(p: Ctx & { openHistory: () => void }) {
  const [items, setItems] = useState<MenuItem[] | null>(null); // the owner's whole menu, in order
  const [cat, setCat] = useState<Catalog | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // What is open on top of the list: a dish's sheet, a new dish, or a draft's check page.
  const [view, setView] = useState<
    | { edit: string }
    | { add: string | true }
    | { check: string }
    | { sections: true }
    | { extras: true }
    | { choose: true }
    | null
  >(null);
  const dragging = useRef(false);
  const { pin, onAuthError } = p;
  const load = useCallback(
    () =>
      admin
        .dishes(pin)
        .then((o) => {
          if (dragging.current) return; // don't pull the row out from under the owner's finger
          const c = mergeCatalog(o, true);
          setCat(c);
          setItems(c.items.filter((i) => !i.testOnly));
        })
        .catch((e) => {
          onAuthError(e);
          setErr('Could not load the menu. Check the internet.');
        }),
    [pin, onAuthError],
  );
  useEffect(() => {
    load();
  }, [load]);
  const failed = (e: unknown, what: string) => {
    p.onAuthError(e);
    setErr(e instanceof ApiError ? e.message : `${what}: no internet.`);
  };
  const toggle = async (i: MenuItem) => {
    setItems((c) => c && c.map((x) => (x.id === i.id ? { ...x, soldOut: !i.soldOut } : x)));
    try {
      await admin.saveItem(p.pin, { itemId: i.id, soldOut: !i.soldOut });
    } catch (e) {
      failed(e, 'Not saved');
    }
    load();
  };
  const show = async (i: MenuItem) => {
    try {
      await admin.menuChange(p.pin, { show: i.id });
    } catch (e) {
      failed(e, 'Not brought back');
    }
    load();
  };

  // Reorder: hold a row's grip and drag it up or down inside its section. The row follows the finger
  // one place at a time; letting go saves the new order.
  const grip = useRef<{ id: string; y: number; h: number } | null>(null);
  const [held, setHeld] = useState<string | null>(null);
  const dragStart = (e: React.PointerEvent<HTMLElement>, i: MenuItem) => {
    const row = e.currentTarget.closest('.mi') as HTMLElement | null;
    if (!row) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    grip.current = { id: i.id, y: e.clientY, h: row.offsetHeight };
    dragging.current = true;
    setHeld(i.id);
  };
  const dragMove = (e: React.PointerEvent<HTMLElement>) => {
    const g = grip.current;
    if (!g) return;
    const step = Math.trunc((e.clientY - g.y) / (g.h * 0.6));
    if (!step) return;
    const dir = step > 0 ? 1 : -1;
    setItems((cur) => {
      if (!cur) return cur;
      const at = cur.findIndex((x) => x.id === g.id);
      const me = cur[at];
      // the next visible dish of the same section in that direction
      let to = at + dir;
      while (cur[to] && (cur[to].cat !== me.cat || cur[to].hidden)) to += dir;
      if (!cur[to]) return cur;
      const next = [...cur];
      next.splice(at, 1);
      next.splice(to, 0, me);
      return next;
    });
    g.y += dir * g.h;
  };
  const dragEnd = async () => {
    if (!grip.current) return;
    grip.current = null;
    setHeld(null);
    try {
      if (items) await admin.menuChange(p.pin, { order: items.map((i) => i.id) });
    } catch (e) {
      failed(e, 'Order not saved');
    }
    dragging.current = false;
    load();
  };

  const all = items ?? [];
  const sel = view && 'edit' in view ? all.find((i) => i.id === view.edit) : undefined;
  const checking = view && 'check' in view ? all.find((i) => i.id === view.check) : undefined;
  const done = () => {
    setView(null);
    load();
  };
  if (checking && cat)
    return (
      <section>
        <Bar
          right={
            <>
              <b>Draft</b>Not on the kiosk yet
            </>
          }
        />
        <Check {...p} item={checking} cat={cat} back={done} edit={() => setView({ edit: checking.id })} />
      </section>
    );
  const hidden = all.filter((i) => i.hidden);
  return (
    <section>
      <Bar
        right={
          <>
            <b>Menu</b>On the kiosk now
          </>
        }
      />
      <div className="h1">Menu</div>
      <div className="hint">
        Switch a dish off when it runs out. It comes back on by itself tomorrow morning. Tap a dish to change it or hide
        it. Hold the dots to move a dish up or down. The kiosk shows changes from the next customer.
      </div>
      <div className="addrow">
        <button className="btn y" onClick={() => setView({ choose: true })} data-testid="open-add">
          Add or change
        </button>
      </div>
      {err && <div className="err pad">{err}</div>}
      {(cat?.cats ?? [])
        .filter((c) => c.id !== TEST_CAT && (c.custom || all.some((i) => i.cat === c.id && !i.hidden)))
        .map((c) => (
          <div className={`mcat ${c.hidden ? 'secoff' : ''}`} key={c.id} data-testid={`mcat-${c.id}`}>
            <div className="hidden-h">
              <h3>{c.name}</h3>
              {c.hidden && <span>Section is off the kiosk</span>}
            </div>
            {!all.some((i) => i.cat === c.id && !i.hidden) && (
              <button className="emptysec" onClick={() => setView({ add: c.id })} data-testid={`add-to-${c.id}`}>
                No dishes yet. Add the first one
              </button>
            )}
            {all
              .filter((i) => i.cat === c.id && !i.hidden)
              .map((i) => {
                const src = photoFor(i);
                return (
                  <div
                    className={`mi mv ${i.soldOut ? 'off' : ''} ${i.draft ? 'draft' : ''} ${held === i.id ? 'held' : ''}`}
                    key={i.id}
                    data-testid={`mi-${i.id}`}
                    data-dish={i.name}
                  >
                    <span
                      className="grip"
                      role="button"
                      aria-label={`Move ${i.name}`}
                      onPointerDown={(e) => dragStart(e, i)}
                      onPointerMove={dragMove}
                      onPointerUp={dragEnd}
                      onPointerCancel={dragEnd}
                      data-testid={`grip-${i.id}`}
                    >
                      <i />
                      <i />
                      <i />
                      <i />
                      <i />
                      <i />
                    </span>
                    <button className="open" onClick={() => setView({ edit: i.id })}>
                      {src ? <img src={src} alt="" /> : <div className="ph">{placeholderFor(i)}</div>}
                      <div>
                        <b>
                          {i.name}
                          {i.draft && <span className="tag">Draft</span>}
                          {i.soldOut && <span className="so">Sold out</span>}
                        </b>
                        <span className="p">₹{i.price}</span>
                      </div>
                    </button>
                    {i.draft ? (
                      <button className="pub" onClick={() => setView({ check: i.id })} data-testid={`pub-${i.id}`}>
                        Publish
                      </button>
                    ) : (
                      <button
                        className={`sw ${i.soldOut ? 'off' : ''}`}
                        role="switch"
                        aria-checked={!i.soldOut}
                        aria-label={`${i.name} on the kiosk`}
                        onClick={() => toggle(i)}
                        data-testid={`sw-${i.id}`}
                      >
                        <span className="swlbl">{i.soldOut ? 'Off' : 'On'}</span>
                      </button>
                    )}
                  </div>
                );
              })}
          </div>
        ))}
      {hidden.length > 0 && (
        <div className="mcat" data-testid="mcat-hidden">
          <div className="hidden-h">
            <h3>Hidden</h3>
            <span>Not on the kiosk. Sales history is kept.</span>
          </div>
          {hidden.map((i) => {
            const src = photoFor(i);
            return (
              <div className="mi gone" key={i.id} data-testid={`mi-${i.id}`}>
                <div className="open">
                  {src ? <img src={src} alt="" /> : <div className="ph">{placeholderFor(i)}</div>}
                  <div>
                    <b>{i.name}</b>
                    <span className="p">₹{i.price}</span>
                  </div>
                </div>
                <button className="back" onClick={() => show(i)} data-testid={`show-${i.id}`}>
                  Bring back
                </button>
              </div>
            );
          })}
        </div>
      )}
      <button className="histlink" onClick={p.openHistory} data-testid="open-history">
        Change history →
      </button>
      {view && 'choose' in view && (
        <>
          <div className="scrim" onClick={() => setView(null)} />
          <div className="sheet" data-testid="add-sheet">
            <div className="grab" />
            <div className="hd">
              <div>
                <span className="eyebrow">Menu</span>
                <div className="disp ttl">Add or change</div>
              </div>
            </div>
            <div className="pick choose">
              <button onClick={() => setView({ add: true })} data-testid="add-dish">
                <span>
                  A new dish
                  <small>Name, price, photo. It stays a draft until you publish it.</small>
                </span>
                <i className="go">›</i>
              </button>
              <button onClick={() => setView({ sections: true })} data-testid="open-sections">
                <span>
                  Sections
                  <small>Add a section, rename, reorder, or switch one off.</small>
                </span>
                <i className="go">›</i>
              </button>
              <button onClick={() => setView({ extras: true })} data-testid="open-extras">
                <span>
                  Extras &amp; kitchen notes
                  <small>What customers can add to a dish, and notes for the kitchen.</small>
                </span>
                <i className="go">›</i>
              </button>
            </div>
            <div className="actions">
              <button className="btn o" onClick={() => setView(null)}>
                Cancel
              </button>
            </div>
          </div>
        </>
      )}
      {view && 'sections' in view && cat && <SectionsSheet {...p} cat={cat} close={done} changed={load} />}
      {view && 'extras' in view && cat && <ExtrasSheet {...p} cat={cat} close={done} changed={load} />}
      {view && 'add' in view && cat && (
        <DishSheet
          {...p}
          section={view.add === true ? undefined : view.add}
          cat={cat}
          close={() => setView(null)}
          saved={(id) => {
            setView({ check: id });
            load();
          }}
        />
      )}
      {sel && cat && sel.custom && (
        <DishSheet
          {...p}
          item={sel}
          cat={cat}
          close={() => setView(null)}
          saved={(id, live) => {
            setView(live ? null : { check: id });
            load();
          }}
        />
      )}
      {sel && cat && !sel.custom && <EditSheet {...p} item={sel} cat={cat} close={() => setView(null)} saved={done} />}
    </section>
  );
}

export function EditSheet(p: Ctx & { item: MenuItem; cat: Catalog; close: () => void; saved: () => void }) {
  const { item, cat } = p;
  const [price, setPrice] = useState(String(item.price));
  const [name, setName] = useState(item.name);
  const [desc, setDesc] = useState(item.desc);
  const [group, setGroup] = useState<string | null>(item.groups[0] ?? null);
  // prices of the extras that came with the app; the owner's own are edited in the Extras sheet
  const extras = item.groups
    .map((g) => cat.groups[g])
    .filter((g) => g.kind === 'many')
    .map((g) => ({ ...g, options: g.options.filter((o) => !o.custom && !o.hidden) }))
    .filter((g) => g.options.length);
  const [ex, setEx] = useState<Record<string, string>>(() =>
    Object.fromEntries(extras.flatMap((g) => g.options.map((o) => [`${g.id}:${o.id}`, String(o.price)]))),
  );
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const n = Number(price);
  const priceOk = /^\d+$/.test(price) && n >= 1 && n <= 100000;
  const withGst = priceOk ? n + Math.round(n * 0.05) : null;
  const save = async () => {
    if (!priceOk) {
      setErr('Price must be a whole number of rupees');
      return;
    }
    if (!name.trim()) {
      setErr('The name can’t be empty');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const patch: Parameters<typeof admin.saveItem>[1] = { itemId: item.id };
      if (n !== item.price) patch.price = n;
      if (name.trim() !== item.name) patch.name = name.trim();
      if (desc.trim() !== item.desc) patch.desc = desc.trim() || null;
      const options: { groupId: string; optionId: string; price: number }[] = [];
      for (const g of extras)
        for (const o of g.options) {
          const v = ex[`${g.id}:${o.id}`];
          if (v === String(o.price)) continue;
          if (!/^\d+$/.test(v) || Number(v) > 100000)
            throw new ApiError(`${o.name}: price must be a whole number of rupees`, 400);
          options.push({ groupId: g.id, optionId: o.id, price: Number(v) });
        }
      if (options.length) patch.options = options;
      if (Object.keys(patch).length > 1) await admin.saveItem(p.pin, patch); // one request: all of it or none
      if (group !== (item.groups[0] ?? null))
        await admin.extrasChange(p.pin, { dishSets: { itemId: item.id, sets: group ? [group] : [] } });
      p.saved();
    } catch (e) {
      p.onAuthError(e);
      setErr(e instanceof ApiError ? e.message : 'Not saved: no internet.');
      setBusy(false);
    }
  };
  return (
    <>
      <div className="scrim" onClick={p.close} />
      <div className="sheet" data-testid="edit-sheet">
        <div className="grab" />
        <div className="hd">
          <div>
            <span className="eyebrow">Edit dish</span>
            <div className="disp ttl">{item.name}</div>
          </div>
        </div>
        <div className="field">
          <label htmlFor="ed-price">Price</label>
          <div className="money">
            <span>₹</span>
            <input
              id="ed-price"
              className="in"
              inputMode="numeric"
              value={price}
              onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
              data-testid="ed-price"
            />
          </div>
          <div className="was">
            {n !== item.price && priceOk ? `Was ₹${item.price} · ` : ''}
            {withGst ? `customers pay about ₹${withGst} with GST` : 'Enter a price'}
          </div>
        </div>
        <div className="field">
          <label htmlFor="ed-name">Name on the kiosk</label>
          <input
            id="ed-name"
            className="in"
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            data-testid="ed-name"
          />
        </div>
        <div className="field">
          <label htmlFor="ed-desc">Description</label>
          <textarea
            id="ed-desc"
            className="in ta"
            value={desc}
            maxLength={160}
            onChange={(e) => setDesc(e.target.value)}
            data-testid="ed-desc"
          />
          <div className="was">Shown under the name on the kiosk. One or two short lines. {desc.length}/160</div>
        </div>
        {extras.map((g) => (
          <div className="field extras" key={g.id}>
            <label>Extras (same price on every dish that has them)</label>
            {g.options.map((o) => (
              <div className="x" key={o.id}>
                <span>{o.name}</span>
                <span className="money sm">
                  <span>₹</span>
                  <input
                    className="in"
                    inputMode="numeric"
                    aria-label={`${o.name} price`}
                    value={ex[`${g.id}:${o.id}`]}
                    onChange={(e) =>
                      setEx({ ...ex, [`${g.id}:${o.id}`]: e.target.value.replace(/[^\d]/g, '').slice(0, 6) })
                    }
                  />
                </span>
              </div>
            ))}
          </div>
        ))}
        <div className="field">
          <label>What customers can add or choose</label>
          <SetPicker cat={cat} value={group} onChange={setGroup} />
        </div>
        {err && <div className="err">{err}</div>}
        <div className="actions">
          <button className="btn y" onClick={save} disabled={busy} data-testid="ed-save">
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button className="btn o" onClick={p.close}>
            Cancel
          </button>
          <HideButton {...p} item={item} done={p.saved} onError={setErr} />
        </div>
      </div>
    </>
  );
}
