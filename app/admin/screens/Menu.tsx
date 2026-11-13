'use client';
// The menu as the kiosk shows it: sold-out switches, and a sheet to edit price, name, description and extras.
import { useCallback, useEffect, useState } from 'react';
import { admin, api, ApiError } from '@/lib/client';
import { CATEGORIES, mergeCatalog, photoOf, placeholderOf, type Catalog, type MenuItem } from '@/lib/menu';
import { Bar, type Ctx } from './shared';

export function Menu(p: Ctx & { openHistory: () => void }) {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const load = useCallback(
    () =>
      api
        .menu()
        .then((o) => setCat(mergeCatalog(o)))
        .catch(() => setErr('Could not load the menu. Check the internet.')),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);
  const toggle = async (i: MenuItem) => {
    setCat((c) => c && { ...c, items: c.items.map((x) => (x.id === i.id ? { ...x, soldOut: !i.soldOut } : x)) });
    try {
      await admin.saveItem(p.pin, { itemId: i.id, soldOut: !i.soldOut });
    } catch (e) {
      p.onAuthError(e);
      setErr(e instanceof ApiError ? e.message : 'Not saved: no internet.');
    }
    load();
  };
  const items = (cat?.items ?? []).filter((i) => !i.testOnly);
  const sel = items.find((i) => i.id === edit);
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
        Switch a dish off when it runs out. It comes back on by itself tomorrow morning. Tap a dish to change its price,
        name or description. The kiosk shows changes from the next customer.
      </div>
      {err && <div className="err pad">{err}</div>}
      {CATEGORIES.filter((c) => items.some((i) => i.cat === c.id)).map((c) => (
        <div className="mcat" key={c.id}>
          <h3>{c.name}</h3>
          {items
            .filter((i) => i.cat === c.id)
            .map((i) => {
              const src = photoOf(i.id);
              return (
                <div className={`mi ${i.soldOut ? 'off' : ''}`} key={i.id} data-testid={`mi-${i.id}`}>
                  <button className="open" onClick={() => setEdit(i.id)}>
                    {src ? <img src={src} alt="" /> : <div className="ph">{placeholderOf(i.id)}</div>}
                    <div>
                      <b>
                        {i.name}
                        {i.soldOut && <span className="so">Sold out</span>}
                      </b>
                      <span className="p">₹{i.price}</span>
                    </div>
                  </button>
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
                </div>
              );
            })}
        </div>
      ))}
      <button className="histlink" onClick={p.openHistory} data-testid="open-history">
        Change history →
      </button>
      {sel && cat && (
        <EditSheet
          {...p}
          item={sel}
          cat={cat}
          close={() => setEdit(null)}
          saved={() => {
            setEdit(null);
            load();
          }}
        />
      )}
    </section>
  );
}

export function EditSheet(p: Ctx & { item: MenuItem; cat: Catalog; close: () => void; saved: () => void }) {
  const { item, cat } = p;
  const [price, setPrice] = useState(String(item.price));
  const [name, setName] = useState(item.name);
  const [desc, setDesc] = useState(item.desc);
  const extras = item.groups.map((g) => cat.groups[g]).filter((g) => g.kind === 'many');
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
        {err && <div className="err">{err}</div>}
        <div className="actions">
          <button className="btn y" onClick={save} disabled={busy} data-testid="ed-save">
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button className="btn o" onClick={p.close}>
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}
