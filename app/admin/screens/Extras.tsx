'use client';
// Extras customers can add to a dish, and the notes they can send to the kitchen: add, rename,
// reprice, switch off. Nothing here is deleted for good, because old orders still show these words.
import { useState } from 'react';
import { admin, ApiError } from '@/lib/client';
import { TEST_CAT, optionKey, type Catalog, type ModGroup, type Tone } from '@/lib/menu';
import type { Ctx } from './shared';

type Change = Parameters<typeof admin.extrasChange>[1];
const digits = (v: string) => v.replace(/[^\d]/g, '').slice(0, 6);
const TONES: { tone: Tone | null; label: string; hint: string }[] = [
  { tone: 'add', label: 'More of something', hint: 'green + on the kitchen chit' },
  { tone: 'less', label: 'Less, or none', hint: 'red − on the kitchen chit' },
  { tone: null, label: 'Just a note', hint: 'plain on the kitchen chit' },
];

export function ExtrasSheet(p: Ctx & { cat: Catalog; close: () => void; changed: () => Promise<unknown> }) {
  const { cat } = p;
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One thing is being edited or added at a time; the rest of the sheet shows what is saved.
  const [edit, setEdit] = useState<{ set: string; id: string; name: string; price: string } | null>(null);
  const [fresh, setFresh] = useState<Record<string, { name: string; price: string }>>({});
  const [setName, setSetName] = useState('');
  const [note, setNote] = useState<{ label: string; tone: Tone | null; cats: string[] }>({
    label: '',
    tone: 'less',
    cats: [],
  });

  const run = async (b: Change) => {
    setBusy(true);
    setErr(null);
    try {
      await admin.extrasChange(p.pin, b);
      await p.changed();
      setBusy(false);
      return true;
    } catch (e) {
      p.onAuthError(e);
      setErr(e instanceof ApiError ? e.message : 'Not saved: no internet.');
      setBusy(false);
      return false;
    }
  };

  const sections = cat.cats.filter((c) => c.id !== TEST_CAT);
  const sets = Object.values(cat.groups).filter((g) => g.kind === 'many');
  // A set that came with the app has no name of its own: call it by the sections that use it.
  const title = (g: ModGroup) => {
    if (g.custom) return g.name;
    const used = sections.filter((c) => cat.items.some((i) => i.cat === c.id && i.groups.includes(g.id)));
    return used.length ? `Extras for ${used.map((c) => c.name).join(', ')}` : 'Extras';
  };
  const usedBy = (g: ModGroup) => cat.items.filter((i) => i.groups.includes(g.id)).length;

  const addExtra = async (g: ModGroup) => {
    const f = fresh[g.id] ?? { name: '', price: '' };
    if (!f.name.trim()) return setErr('Give the extra a name');
    if (f.price === '') return setErr('Give the extra a price (0 for free)');
    if (await run({ extra: { set: g.id, name: f.name.trim(), price: Number(f.price) } }))
      setFresh({ ...fresh, [g.id]: { name: '', price: '' } });
  };
  const saveEdit = async () => {
    if (!edit) return;
    if (!edit.name.trim()) return setErr('The extra needs a name');
    if (edit.price === '') return setErr('Give the extra a price (0 for free)');
    if (await run({ extra: { set: edit.set, id: edit.id, name: edit.name.trim(), price: Number(edit.price) } }))
      setEdit(null);
  };
  const addNote = async () => {
    if (!note.label.trim()) return setErr('Write the note');
    if (!note.cats.length) return setErr('Pick the sections whose dishes take this note');
    if (await run({ note: { label: note.label.trim(), tone: note.tone, cats: note.cats } }))
      setNote({ label: '', tone: 'less', cats: [] });
  };

  return (
    <>
      <div className="scrim" onClick={p.close} />
      <div className="sheet" data-testid="extras-sheet">
        <div className="grab" />
        <div className="hd">
          <div>
            <span className="eyebrow">Menu</span>
            <div className="disp ttl">Extras &amp; kitchen notes</div>
          </div>
        </div>
        <div className="was">
          Extras are what a customer can add to a dish for a price. Tap one to change its name or price; switch it off
          when you stop offering it. Which dishes offer a set is chosen in each dish&apos;s own sheet.
        </div>

        {sets.map((g) => {
          const f = fresh[g.id] ?? { name: '', price: '' };
          return (
            <div className="xset" key={g.id} data-testid={`xset-${g.id}`}>
              <div className="xh">
                <h3>{title(g)}</h3>
                <span>
                  {usedBy(g)} {usedBy(g) === 1 ? 'dish' : 'dishes'}
                </span>
              </div>
              {g.options.length === 0 && <div className="none">No extras in this set yet.</div>}
              {g.options.map((o) =>
                edit && edit.set === g.id && edit.id === o.id ? (
                  <div className="xrow editing" key={o.id}>
                    <input
                      className="in"
                      autoFocus
                      maxLength={30}
                      aria-label="Extra name"
                      value={edit.name}
                      onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                      data-testid="x-edit-name"
                    />
                    <span className="money sm">
                      <span>₹</span>
                      <input
                        className="in"
                        inputMode="numeric"
                        aria-label="Extra price"
                        value={edit.price}
                        onChange={(e) => setEdit({ ...edit, price: digits(e.target.value) })}
                        data-testid="x-edit-price"
                      />
                    </span>
                    <button className="link" disabled={busy} onClick={saveEdit} data-testid="x-edit-save">
                      Save
                    </button>
                  </div>
                ) : (
                  <div className={`xrow ${o.hidden ? 'off' : ''}`} key={o.id} data-testid={`x-${g.id}-${o.id}`}>
                    <button
                      className="nm"
                      onClick={() => setEdit({ set: g.id, id: o.id, name: o.name, price: String(o.price) })}
                    >
                      <b>{o.name}</b>
                      <span className="p">{o.price ? `+₹${o.price}` : 'Free'}</span>
                    </button>
                    <button
                      className={`sw ${o.hidden ? 'off' : ''}`}
                      role="switch"
                      aria-checked={!o.hidden}
                      aria-label={`${o.name} on the kiosk`}
                      disabled={busy}
                      onClick={() =>
                        run(o.hidden ? { showExtra: optionKey(g.id, o.id) } : { hideExtra: optionKey(g.id, o.id) })
                      }
                      data-testid={`x-sw-${g.id}-${o.id}`}
                    >
                      <span className="swlbl">{o.hidden ? 'Off' : 'On'}</span>
                    </button>
                  </div>
                ),
              )}
              <div className="xrow xnew">
                <input
                  className="in"
                  placeholder="New extra, e.g. Extra cheese"
                  maxLength={30}
                  aria-label={`New extra in ${title(g)}`}
                  value={f.name}
                  onChange={(e) => setFresh({ ...fresh, [g.id]: { ...f, name: e.target.value } })}
                  data-testid={`x-new-name-${g.id}`}
                />
                <span className="money sm">
                  <span>₹</span>
                  <input
                    className="in"
                    inputMode="numeric"
                    aria-label="Its price"
                    value={f.price}
                    onChange={(e) => setFresh({ ...fresh, [g.id]: { ...f, price: digits(e.target.value) } })}
                    data-testid={`x-new-price-${g.id}`}
                  />
                </span>
                <button className="link" disabled={busy} onClick={() => addExtra(g)} data-testid={`x-add-${g.id}`}>
                  Add
                </button>
              </div>
              {g.custom && g.options.length === 0 && usedBy(g) === 0 && (
                <button
                  className="link rm"
                  disabled={busy}
                  onClick={() => run({ removeSet: g.id })}
                  data-testid={`xset-remove-${g.id}`}
                >
                  Remove this set
                </button>
              )}
            </div>
          );
        })}

        <div className="field">
          <label htmlFor="xset-new">New set of extras</label>
          <div className="newsec">
            <input
              id="xset-new"
              className="in"
              placeholder="e.g. Add on top"
              maxLength={24}
              value={setName}
              onChange={(e) => setSetName(e.target.value)}
              data-testid="xset-new"
            />
            <button
              className="btn y"
              disabled={busy}
              onClick={async () => {
                if (!setName.trim()) return setErr('Give the set a name');
                if (await run({ set: { name: setName.trim() } })) setSetName('');
              }}
              data-testid="xset-add"
            >
              Add
            </button>
          </div>
          <div className="was">The name is the heading customers see above these extras, like “Make it extra”.</div>
        </div>

        <div className="xset" data-testid="notes">
          <div className="xh">
            <h3>Kitchen notes</h3>
            <span>free, printed on the chit</span>
          </div>
          {cat.notes.map((n) => (
            <div className={`xrow ${n.hidden ? 'off' : ''}`} key={n.id} data-testid={`note-${n.id}`}>
              <div className="nm">
                <b>
                  <i className={`tone t-${n.tone ?? 'plain'}`}>
                    {n.tone === 'add' ? '+' : n.tone === 'less' ? '−' : '·'}
                  </i>
                  {n.label}
                </b>
                <span className="p sub">
                  {n.custom
                    ? sections
                        .filter((c) => n.cats?.includes(c.id))
                        .map((c) => c.name)
                        .join(', ')
                    : 'Came with the app'}
                </span>
              </div>
              <button
                className={`sw ${n.hidden ? 'off' : ''}`}
                role="switch"
                aria-checked={!n.hidden}
                aria-label={`${n.label} on the kiosk`}
                disabled={busy}
                onClick={() => run(n.hidden ? { showNote: n.id } : { hideNote: n.id })}
                data-testid={`note-sw-${n.id}`}
              >
                <span className="swlbl">{n.hidden ? 'Off' : 'On'}</span>
              </button>
            </div>
          ))}
        </div>
        <div className="field">
          <label htmlFor="note-new">New kitchen note</label>
          <input
            id="note-new"
            className="in"
            style={{ width: '100%' }}
            placeholder="e.g. No onion"
            maxLength={30}
            value={note.label}
            onChange={(e) => setNote({ ...note, label: e.target.value })}
            data-testid="note-new"
          />
          <div className="pick" role="radiogroup" aria-label="Kind of note" style={{ marginTop: 10 }}>
            {TONES.map((t) => (
              <button
                key={t.label}
                role="radio"
                aria-checked={note.tone === t.tone}
                className={note.tone === t.tone ? 'on' : ''}
                onClick={() => setNote({ ...note, tone: t.tone })}
                data-testid={`note-tone-${t.tone ?? 'plain'}`}
              >
                <span>
                  {t.label}
                  <small>{t.hint}</small>
                </span>
                <i className="r" />
              </button>
            ))}
          </div>
          <div className="was">Dishes in these sections offer it:</div>
          <div className="pick" style={{ marginTop: 6 }}>
            {sections.map((c) => {
              const on = note.cats.includes(c.id);
              return (
                <button
                  key={c.id}
                  role="checkbox"
                  aria-checked={on}
                  className={on ? 'on' : ''}
                  onClick={() =>
                    setNote({ ...note, cats: on ? note.cats.filter((x) => x !== c.id) : [...note.cats, c.id] })
                  }
                  data-testid={`note-cat-${c.id}`}
                >
                  <span>{c.name}</span>
                  <i className="r sq" />
                </button>
              );
            })}
          </div>
          <div className="actions">
            <button className="btn y" disabled={busy} onClick={addNote} data-testid="note-add">
              Add this note
            </button>
          </div>
        </div>

        {err && (
          <div className="err" data-testid="extras-err">
            {err}
          </div>
        )}
        <div className="actions">
          <button className="btn o" onClick={p.close} data-testid="extras-done">
            Done
          </button>
        </div>
      </div>
    </>
  );
}
