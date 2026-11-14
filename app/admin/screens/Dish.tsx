'use client';
// The owner's own dishes: the sheet to add or edit one (with a photo), the "check, then publish"
// page for a draft, and the hide button every dish's sheet ends with.
import { useRef, useState } from 'react';
import { admin, ApiError } from '@/lib/client';
import { TEST_CAT, notesFor, photoFor, placeholderFor, type Catalog, type MenuItem } from '@/lib/menu';
import type { Ctx } from './shared';

const say = (e: unknown, what: string) => (e instanceof ApiError ? e.message : `${what}: no internet.`);

// A phone photo is several megabytes; the kiosk shows it a few hundred pixels wide. Shrink it here,
// so the upload is quick on the shop's connection and every stored photo is a plain JPEG.
async function shrink(file: File, max = 1000): Promise<Blob> {
  const img = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k);
  c.height = Math.round(img.height * k);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error('no image'))), 'image/jpeg', 0.85));
}

// What a set of extras is called in the picker: its extras, as the customer reads them.
const groupLine = (cat: Catalog, id: string) => {
  const g = cat.groups[id];
  const on = g.options.filter((o) => !o.hidden).map((o) => o.name);
  return {
    title: g.custom ? g.name : g.kind === 'many' ? 'Extras' : g.name,
    sub: on.length ? on.join(', ') : 'Nothing in it yet',
  };
};

// Which set of extras (or the sugar choice) a dish offers: one of them, or nothing.
export function SetPicker(p: { cat: Catalog; value: string | null; onChange: (g: string | null) => void }) {
  return (
    <div className="pick" role="radiogroup" aria-label="Extras">
      {Object.keys(p.cat.groups).map((g) => {
        const t = groupLine(p.cat, g);
        return (
          <button
            key={g}
            role="radio"
            aria-checked={p.value === g}
            className={p.value === g ? 'on' : ''}
            onClick={() => p.onChange(g)}
            data-testid={`dish-group-${g}`}
          >
            <span>
              {t.title}
              <small>{t.sub}</small>
            </span>
            <i className="r" />
          </button>
        );
      })}
      <button
        role="radio"
        aria-checked={p.value === null}
        className={p.value === null ? 'on' : ''}
        onClick={() => p.onChange(null)}
        data-testid="dish-group-none"
      >
        <span>Nothing</span>
        <i className="r" />
      </button>
    </div>
  );
}

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
  const [group, setGroup] = useState<string | null>(
    item ? (item.groups[0] ?? null) : p.section && p.section !== 'dosa' ? null : 'dosaExtras',
  );
  const [photo, setPhoto] = useState<string | null>(item?.photo ?? null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<'photo' | 'save' | null>(null);
  const take = useRef<HTMLInputElement>(null);
  const choose = useRef<HTMLInputElement>(null);
  const n = Number(price);
  const priceOk = /^\d+$/.test(price) && n >= 1 && n <= 100000;
  const live = !!item && !item.draft;

  const pickPhoto = async (f: File | undefined) => {
    if (!f) return;
    setBusy('photo');
    setErr(null);
    try {
      setPhoto((await admin.photo(p.pin, await shrink(f))).url);
    } catch (e) {
      p.onAuthError(e);
      setErr(e instanceof ApiError ? e.message : 'That photo could not be used. Try another.');
    }
    setBusy(null);
  };
  const save = async () => {
    if (!name.trim()) return setErr('The dish needs a name');
    if (!priceOk) return setErr('Price must be a whole number of rupees');
    setBusy('save');
    setErr(null);
    try {
      const r = await admin.menuChange(p.pin, {
        dish: {
          id: item?.id,
          cat: section,
          name: name.trim(),
          desc: desc.trim(),
          price: n,
          groups: group ? [group] : [],
          photo,
        },
      });
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
        <div className="field">
          <label>Photo</label>
          <div className="photo">
            {photo ? <img src={photo} alt="" data-testid="dish-photo" /> : <div className="ph">No photo</div>}
            <div>
              <div className="two">
                <button className="btn o" disabled={!!busy} onClick={() => take.current?.click()}>
                  Take photo
                </button>
                <button className="btn o" disabled={!!busy} onClick={() => choose.current?.click()}>
                  Choose
                </button>
              </div>
              <div className="was">
                {busy === 'photo' ? 'Uploading…' : 'Hold the phone level, plate in the middle. No photo is fine too.'}
              </div>
            </div>
          </div>
          <input
            ref={take}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => pickPhoto(e.target.files?.[0])}
          />
          <input
            ref={choose}
            type="file"
            accept="image/*"
            hidden
            data-testid="dish-file"
            onChange={(e) => pickPhoto(e.target.files?.[0])}
          />
        </div>
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
                onClick={() => setSection(c.id)}
                data-testid={`dish-cat-${c.id}`}
              >
                <span>{c.name}</span>
                <i className="r" />
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>What customers can add or choose</label>
          <SetPicker cat={cat} value={group} onChange={setGroup} />
        </div>
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
  const notes = notesFor(item, cat)
    .filter((n) => !n.hidden)
    .map((n) => n.label);
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
          <b>{item.groups.length ? item.groups.map((g) => groupLine(cat, g).sub).join(', ') : 'Nothing'}</b>
        </div>
        <div>
          <span>Kitchen notes</span>
          <b>{notes.length ? notes.join(', ') : 'None'}</b>
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
