'use client';
// The owner's own dishes: the sheet to add or edit one (with a photo), the "check, then publish"
// page for a draft, and the hide button every dish's sheet ends with.
import { useState } from 'react';
import { admin, ApiError } from '@/lib/client';
import { COMES_WITH, TEST_CAT, extrasOf, photoFor, placeholderFor, type Catalog, type MenuItem } from '@/lib/menu';
import { DishExtras, extrasChanged, rowsOf } from './DishExtras';
import { PhotoField } from './PhotoField';
import type { Ctx } from './shared';

const say = (e: unknown, what: string) => (e instanceof ApiError ? e.message : `${what}: no internet.`);

// "Hide from the menu", asked twice. Used at the bottom of every live dish's sheet.
export function HideButton(p: Ctx & { item: MenuItem; done: () => void; onError: (m: string) => void }) {
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const hide = async () => {
    setBusy(true);
    try {
      await admin.menuChange(p.pin, { hide: p.item.id });
      p.done();
    } catch (e) {
      p.onAuthError(e);
      p.onError(say(e, 'Not hidden'));
      setBusy(false);
    }
  };
  return (
    <>
      <button className="btn r" disabled={busy} onClick={() => (sure ? hide() : setSure(true))} data-testid="dish-hide">
        {sure ? `Yes, hide ${p.item.name}` : 'Hide from the menu'}
      </button>
      <div className="was">
        Hiding takes it off the kiosk and the TV. It waits under “Hidden” with its sales history, and one tap brings it
        back.
      </div>
    </>
  );
}

// "Delete this dish", asked twice. Only for dishes the owner added: the ones that came with the app
// can be hidden, and their sales history is under their name either way.
export function DeleteButton(p: Ctx & { item: MenuItem; done: () => void; onError: (m: string) => void }) {
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const del = async () => {
    setBusy(true);
    try {
      await admin.menuChange(p.pin, { delete: p.item.id });
      p.done();
    } catch (e) {
      p.onAuthError(e);
      p.onError(say(e, 'Not deleted'));
      setBusy(false);
    }
  };
  return (
    <>
      <button
        className="btn r"
        disabled={busy}
        onClick={() => (sure ? del() : setSure(true))}
        data-testid="dish-delete"
      >
        {sure ? `Yes, delete ${p.item.name} for good` : 'Delete this dish'}
      </button>
      <div className="was">Deleting cannot be undone. Bills and reports already made keep the dish.</div>
    </>
  );
}

export function DishSheet(
  p: Ctx & {
    item?: MenuItem;
    section?: string; // where a new dish starts
    cat: Catalog;
    close: () => void;
    saved: (id: string, live: boolean) => void;
  },
) {
  const { item, cat } = p;
  const [name, setName] = useState(item?.name ?? '');
  const [price, setPrice] = useState(item ? String(item.price) : '');
  const [desc, setDesc] = useState(item?.desc ?? '');
  const sections = cat.cats.filter((c) => c.id !== TEST_CAT);
  const [section, setSection] = useState(item?.cat ?? p.section ?? sections[0]?.id ?? 'dosa');
  const [rows, setRows] = useState(() => rowsOf(item ? extrasOf(item, cat) : []));
  const [sugar, setSugar] = useState(!!item?.groups.includes('sugar'));
  // a new dish starts with the line its section's dishes carry; the owner can change or clear it
  const usual = (sec: string) => (sec === 'dosa' || sec === 'idli' ? COMES_WITH : '');
  const [comesWith, setComesWith] = useState(item ? (item.comesWith ?? '') : usual(section));
  const [photo, setPhoto] = useState<string | null>(item?.photo ?? null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<'photo' | 'save' | null>(null);
  // A new dish is saved in two steps (the dish, then its extras). If the second fails, a second
  // tap on Save must finish this dish, not make another.
  const [madeId, setMadeId] = useState<string | null>(null);
  const n = Number(price);
  const priceOk = /^\d+$/.test(price) && n >= 1 && n <= 100000;
  const live = !!item && !item.draft;

  const save = async () => {
    if (!name.trim()) return setErr('The dish needs a name');
    if (!priceOk) return setErr('Price must be a whole number of rupees');
    setBusy('save');
    setErr(null);
    try {
      const own = extrasChanged(rows, comesWith, {
        extras: item ? extrasOf(item, cat) : [],
        comesWith: item ? (item.comesWith ?? '') : usual(section),
      });
      // an existing dish's list is saved first, while the server still knows what it offered before
      if (item && own) await admin.extrasChange(p.pin, { dish: { itemId: item.id, ...own } });
      // a dish still on its section's shared extras keeps them until its own list is edited
      const shared = item && !item.ownExtras && !own?.extras ? item.groups.filter((g) => g !== 'sugar') : [];
      const r = await admin.menuChange(p.pin, {
        dish: {
          id: item?.id ?? madeId ?? undefined,
          cat: section,
          name: name.trim(),
          desc: desc.trim(),
          price: n,
          groups: [...shared, ...(sugar ? ['sugar'] : [])],
          photo,
        },
      });
      if (!item) setMadeId(r.dish!.id);
      if (!item && own) await admin.extrasChange(p.pin, { dish: { itemId: r.dish!.id, ...own } });
      p.saved(r.dish!.id, r.dish!.live);
    } catch (e) {
      p.onAuthError(e);
      setErr(say(e, 'Not saved'));
      setBusy(null);
    }
  };
  return (
    <>
      <div className="scrim" onClick={p.close} />
      <div className="sheet" data-testid="dish-sheet">
        <div className="grab" />
        <div className="hd">
          <div>
            <span className="eyebrow">{item ? (live ? 'Edit dish' : 'Draft') : 'New dish'}</span>
            <div className="disp ttl">{name.trim() || 'New dish'}</div>
          </div>
        </div>
        <PhotoField
          {...p}
          photo={photo}
          onPhoto={setPhoto}
          onError={setErr}
          disabled={!!busy}
          onBusy={(up) => setBusy(up ? 'photo' : null)}
          hint="Hold the phone level, plate in the middle. No photo is fine too."
        />
        <div className="field">
          <label htmlFor="dish-name">Name on the kiosk</label>
          <input
            id="dish-name"
            className="in"
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            data-testid="dish-name"
          />
        </div>
        <div className="field">
          <label htmlFor="dish-price">Price</label>
          <div className="money">
            <span>₹</span>
            <input
              id="dish-price"
              className="in"
              inputMode="numeric"
              value={price}
              onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
              data-testid="dish-price"
            />
          </div>
          <div className="was">
            {priceOk ? `customers pay about ₹${n + Math.round(n * 0.05)} with GST` : 'Enter a price'}
          </div>
        </div>
        <div className="field">
          <label htmlFor="dish-desc">Description</label>
          <textarea
            id="dish-desc"
            className="in ta"
            value={desc}
            maxLength={160}
            onChange={(e) => setDesc(e.target.value)}
            data-testid="dish-desc"
          />
          <div className="was">Shown under the name on the kiosk. One or two short lines. {desc.length}/160</div>
        </div>
        <div className="field">
          <label>Section</label>
          <div className="pick" role="radiogroup" aria-label="Section">
            {sections.map((c) => (
              <button
                key={c.id}
                role="radio"
                aria-checked={section === c.id}
                className={section === c.id ? 'on' : ''}
                onClick={() => {
                  // a new dish's untouched "Comes with" follows the section picked
                  if (!item && comesWith === usual(section)) setComesWith(usual(c.id));
                  setSection(c.id);
                }}
                data-testid={`dish-cat-${c.id}`}
              >
                <span>{c.name}</span>
                <i className="r" />
              </button>
            ))}
          </div>
        </div>
        <DishExtras
          cat={cat}
          self={item}
          comesWith={comesWith}
          setComesWith={setComesWith}
          rows={rows}
          setRows={setRows}
          sugar={sugar}
          setSugar={setSugar}
          disabled={!!busy}
        />
        {err && (
          <div className="err" data-testid="dish-err">
            {err}
          </div>
        )}
        <div className="actions">
          <button className="btn y" onClick={save} disabled={!!busy} data-testid="dish-save">
            {busy === 'save' ? 'Saving…' : live ? 'Save' : 'See it on the kiosk'}
          </button>
          <button className="btn o" onClick={p.close}>
            Cancel
          </button>
          {live && item && <HideButton {...p} item={item} done={() => p.saved(item.id, true)} onError={setErr} />}
          {item && <DeleteButton {...p} item={item} done={() => p.saved(item.id, true)} onError={setErr} />}
        </div>
      </div>
    </>
  );
}

// A draft, as customers would see it, with the one button that puts it on the kiosk.
export function Check(p: Ctx & { item: MenuItem; cat: Catalog; back: () => void; edit: () => void }) {
  const { item, cat } = p;
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);
  const run = async (b: { publish: string } | { discard: string }, what: string) => {
    setBusy(true);
    setErr(null);
    try {
      await admin.menuChange(p.pin, b);
      p.back();
    } catch (e) {
      p.onAuthError(e);
      setErr(say(e, what));
      setBusy(false);
    }
  };
  const src = photoFor(item);
  const offers = [
    ...extrasOf(item, cat).map((x) => x.name),
    ...(item.groups.includes('sugar') ? ['Sugar choice'] : []),
  ];
  return (
    <div data-testid="dish-check">
      <div className="h1">
        <button className="hback" onClick={p.back} aria-label="Back to menu">
          ←
        </button>
        {item.name}
      </div>
      <div className="kprev">
        <div className="lbl">How customers will see it</div>
        <div className={`kcard ${src ? '' : 'bare'}`}>
          {src ? <img src={src} alt="" /> : <div className="ph">{placeholderFor(item)}</div>}
          <div className="t">
            <b>{item.name}</b>
            <p>{item.desc}</p>
            <div className="f">
              <span className="pr">₹{item.price}</span>
              <span className="plus">+</span>
            </div>
          </div>
        </div>
      </div>
      <div className="facts">
        <div>
          <span>Section</span>
          <b>{cat.cats.find((c) => c.id === item.cat)?.name}</b>
        </div>
        <div>
          <span>Customers can add</span>
          <b>{offers.length ? offers.join(', ') : 'Nothing'}</b>
        </div>
        <div>
          <span>Comes with</span>
          <b>{item.comesWith || 'Nothing shown'}</b>
        </div>
        <div>
          <span>With GST</span>
          <b>about ₹{item.price + Math.round(item.price * 0.05)}</b>
        </div>
      </div>
      {err && <div className="err pad">{err}</div>}
      <div className="actions pad">
        <button
          className="btn y"
          disabled={busy}
          onClick={() => run({ publish: item.id }, 'Not published')}
          data-testid="dish-publish"
        >
          Publish to the kiosk
        </button>
        <button className="btn o" onClick={p.back}>
          Keep as draft
        </button>
      </div>
      <div className="was pad">
        After publishing, the kiosk and the TV show it from the next customer. You can hide it again any time.
      </div>
      <div className="actions pad">
        <button className="btn o" onClick={p.edit}>
          Edit
        </button>
        <button
          className="btn r"
          disabled={busy}
          onClick={() => (sure ? run({ discard: item.id }, 'Not discarded') : setSure(true))}
          data-testid="dish-discard"
        >
          {sure ? 'Yes, throw this draft away' : 'Discard draft'}
        </button>
      </div>
    </div>
  );
}
