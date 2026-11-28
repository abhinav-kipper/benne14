'use client';
// On a dish's page: the grey "Comes with" line, the dish's own list of extras (add, price, remove;
// ₹0 is a free tick box), copying the list from another dish, and the sugar choice for drinks.
import { useState } from 'react';
import { ApiError } from '@/lib/client';
import { extrasOf, type Catalog, type DishExtra, type MenuItem } from '@/lib/menu';

export const MAX_EXTRAS = 16; // the server's limit (app/api/admin/extras/route.ts)
export interface ExtraRow {
  key: number; // for React only
  id?: string; // kept while the extra stays on the dish
  name: string;
  price: string; // as typed
}
let nextKey = 1;
export const rowsOf = (list: DishExtra[]): ExtraRow[] =>
  list.map((x) => ({ key: nextKey++, id: x.id, name: x.name, price: String(x.price) }));

// What to send to the server, or a plain sentence saying which row is not right.
export function extrasToSave(rows: ExtraRow[]): { id?: string; name: string; price: number }[] {
  const seen = new Set<string>();
  return rows.map((r) => {
    const name = r.name.trim();
    if (!name) throw new ApiError('Every extra needs a name (or remove the empty row)', 400);
    if (!/^\d+$/.test(r.price) || Number(r.price) > 100000)
      throw new ApiError(`${name}: price must be a whole number of rupees (0 for free)`, 400);
    if (seen.has(name.toLowerCase())) throw new ApiError(`${name} is on the list twice`, 400);
    seen.add(name.toLowerCase());
    return { id: r.id, name, price: Number(r.price) };
  });
}

// What changed on the page, as the server wants it: only the parts the owner touched, so a dish
// keeps sharing its section's extras until its own list is really edited.
export function extrasChanged(
  rows: ExtraRow[],
  comesWith: string,
  was: { extras: DishExtra[]; comesWith: string },
): { extras?: { id?: string; name: string; price: number }[]; comesWith?: string } | null {
  const extras = extrasToSave(rows);
  const line = (l: { name: string; price: number }[]) => JSON.stringify(l.map((x) => [x.name, x.price]));
  const out: { extras?: typeof extras; comesWith?: string } = {};
  if (line(extras) !== line(was.extras)) out.extras = extras;
  if (comesWith.trim() !== was.comesWith) out.comesWith = comesWith.trim();
  return out.extras || out.comesWith !== undefined ? out : null;
}

export function DishExtras(p: {
  cat: Catalog;
  self?: MenuItem; // the dish being edited: left out of "copy from"
  comesWith: string;
  setComesWith: (v: string) => void;
  rows: ExtraRow[];
  setRows: (r: ExtraRow[]) => void;
  sugar: boolean;
  setSugar: (v: boolean) => void;
  disabled?: boolean;
}) {
  const [copying, setCopying] = useState(false);
  const others = p.cat.items
    .filter((i) => !i.testOnly && i.id !== p.self?.id)
    .map((i) => ({ item: i, list: extrasOf(i, p.cat) }))
    .filter((x) => x.list.length);
  const change = (key: number, patch: Partial<ExtraRow>) =>
    p.setRows(p.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <>
      <div className="field">
        <label htmlFor="dish-with">Comes with</label>
        <input
          id="dish-with"
          className="in"
          value={p.comesWith}
          maxLength={80}
          onChange={(e) => p.setComesWith(e.target.value)}
          placeholder="Nothing shown"
          data-testid="dish-with"
        />
        <div className="was">Shown in grey under the description on the kiosk. Leave empty to show nothing.</div>
      </div>
      <div className="field xl" data-testid="dish-extras">
        <label>Extras customers can add</label>
        {p.rows.map((r, n) => (
          <div className="xrow2" key={r.key} data-testid="extra-row">
            <input
              className="in"
              value={r.name}
              maxLength={30}
              placeholder="Name"
              aria-label={`Extra ${n + 1} name`}
              onChange={(e) => change(r.key, { name: e.target.value })}
              data-testid="extra-name"
            />
            <span className="money sm">
              <span>₹</span>
              <input
                className="in"
                inputMode="numeric"
                value={r.price}
                aria-label={`${r.name || `Extra ${n + 1}`} price`}
                onChange={(e) => change(r.key, { price: e.target.value.replace(/[^\d]/g, '').slice(0, 6) })}
                data-testid="extra-price"
              />
            </span>
            <button
              className="rm"
              aria-label={`Remove ${r.name || `extra ${n + 1}`}`}
              disabled={p.disabled}
              onClick={() => p.setRows(p.rows.filter((x) => x.key !== r.key))}
              data-testid="extra-remove"
            >
              ×
            </button>
          </div>
        ))}
        <div className="was">
          {p.rows.length
            ? '₹0 shows as a free tick box, with no price. Changes here are for this dish only.'
            : 'No extras on this dish yet.'}
        </div>
        <div className="actions">
          <button
            className="btn o"
            disabled={p.disabled || p.rows.length >= MAX_EXTRAS}
            onClick={() => p.setRows([...p.rows, { key: nextKey++, name: '', price: '' }])}
            data-testid="extra-add"
          >
            + Add an extra
          </button>
          {others.length > 0 && (
            <button
              className="btn o"
              disabled={p.disabled}
              onClick={() => setCopying(!copying)}
              data-testid="extra-copy"
            >
              {copying ? 'Cancel copying' : 'Copy from another dish'}
            </button>
          )}
        </div>
        {copying && (
          <div className="pick" data-testid="extra-copy-list">
            {others.map(({ item, list }) => (
              <button
                key={item.id}
                onClick={() => {
                  // a copy: the same names and prices, now this dish's own to change
                  p.setRows(
                    list.slice(0, MAX_EXTRAS).map((x) => ({ key: nextKey++, name: x.name, price: String(x.price) })),
                  );
                  setCopying(false);
                }}
                data-testid={`extra-copy-${item.id}`}
              >
                <span>
                  {item.name}
                  <small>{list.map((x) => x.name).join(', ')}</small>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      {p.cat.groups.sugar && (
        <div className="field">
          <label>Sugar choice</label>
          <div className="orow">
            <div>
              <b>Ask how much sugar</b>
              <small>For drinks: regular, less or no sugar.</small>
            </div>
            <button
              className={`sw ${p.sugar ? '' : 'off'}`}
              role="switch"
              aria-checked={p.sugar}
              aria-label="Ask how much sugar"
              onClick={() => p.setSugar(!p.sugar)}
              data-testid="dish-sugar"
            >
              <span className="swlbl">{p.sugar ? 'On' : 'Off'}</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
