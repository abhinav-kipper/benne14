'use client';
// One dish: extras, kitchen notes, the filter-coffee pairing and quantity.
import { useState } from 'react';
import { useCatalog } from '@/components/Catalog';
import { PAIRING, itemById, notesFor } from '@/lib/menu';
import { priceLine, type CartLine } from '@/lib/pricing';
import { Photo, type Line } from './shared';

export function ItemSheet({
  itemId,
  editing,
  pairingInCart,
  onClose,
  onAdd,
}: {
  itemId: string;
  editing?: Line;
  pairingInCart: boolean;
  onClose: () => void;
  onAdd: (l: CartLine, withPairing: boolean) => void;
}) {
  const catalog = useCatalog();
  const item = itemById(itemId, catalog)!;
  const [qty, setQty] = useState(editing?.qty ?? 1);
  const [choices, setChoices] = useState<Record<string, string[]>>(() => {
    if (editing) return editing.choices;
    const c: Record<string, string[]> = {};
    for (const g of item.groups) if (catalog.groups[g].kind === 'one') c[g] = [catalog.groups[g].defaultId!];
    return c;
  });
  const [notes, setNotes] = useState<string[]>(editing?.notes ?? []);
  const [pair, setPair] = useState(false);
  const line: CartLine = { itemId, qty, choices, notes };
  const total = priceLine(line, catalog).lineTotal + (pair ? itemById(PAIRING, catalog)!.price : 0);
  const showPair =
    item.id !== PAIRING && item.cat !== 'drinks' && !pairingInCart && !editing && !itemById(PAIRING, catalog)?.soldOut;
  const pairing = itemById(PAIRING, catalog)!;

  const pick = (g: string, id: string) =>
    setChoices((c) => {
      if (catalog.groups[g].kind === 'one') return { ...c, [g]: [id] };
      const cur = c[g] ?? [];
      return { ...c, [g]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] };
    });

  return (
    <>
      <div className="k-sheet-scrim" onClick={onClose} />
      <div className="k-sheet" data-testid="sheet">
        <div className="ph">
          <Photo item={item} big />
          <button className="close" onClick={onClose} aria-label="Close">
            ×
          </button>
          <div className="head">
            <div>
              {item.special && <span className="chip">House special</span>}
              <h1 className="disp" style={{ marginTop: 14 }}>
                {item.name}
              </h1>
            </div>
            <div style={{ textAlign: 'right' }}>
              <span className="price" style={{ fontSize: 44 }}>
                ₹{item.price}
              </span>
            </div>
          </div>
        </div>
        <div className="body">
          <p className="desc hdesc">
            {item.desc}
            {item.cat !== 'drinks' && <span className="incl">Comes with coconut chutney &amp; sambar</span>}
          </p>
          {item.groups.map((gid) => {
            const g = catalog.groups[gid];
            const on = choices[gid] ?? [];
            return (
              <div className="grp" key={gid}>
                <div className="gh">
                  <h3 className="disp">{g.name}</h3>
                  <small>{g.kind === 'one' ? 'Pick one' : 'Optional'}</small>
                </div>
                {g.kind === 'one' ? (
                  <div className="seg">
                    {g.options.map((o) => (
                      <button
                        key={o.id}
                        className={`opt ${on.includes(o.id) ? 'on' : ''}`}
                        onClick={() => pick(gid, o.id)}
                      >
                        <b>{o.name}</b>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="adds">
                    {g.options.map((o) => (
                      <button
                        key={o.id}
                        className={`addon ${on.includes(o.id) ? 'on' : ''}`}
                        onClick={() => pick(gid, o.id)}
                        data-testid={`addon-${o.id}`}
                      >
                        <span className="box">{on.includes(o.id) ? '✓' : ''}</span>
                        <b>{o.name}</b>
                        <span className="p">+₹{o.price}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {notesFor(item).length > 0 && (
            <div className="grp">
              <div className="gh">
                <h3 className="disp">Note for the kitchen</h3>
                <small>Tap any</small>
              </div>
              <div className="notes">
                {notesFor(item).map((n) => (
                  <button
                    key={n.id}
                    className={`note ${notes.includes(n.id) ? 'on' : ''}`}
                    onClick={() =>
                      setNotes((cur) => (cur.includes(n.id) ? cur.filter((x) => x !== n.id) : [...cur, n.id]))
                    }
                  >
                    {n.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {showPair && (
            <div className="grp pair">
              <div className="pimg">
                <Photo item={pairing} />
              </div>
              <div style={{ flex: 1 }}>
                <small className="eyebrow">Goes well with</small>
                <b>{pairing.name}</b>
                <span>{pairing.desc}</span>
              </div>
              <span className="price" style={{ fontSize: 26 }}>
                +₹{pairing.price}
              </span>
              <button
                className={`add ${pair ? 'on' : ''}`}
                onClick={() => setPair((v) => !v)}
                aria-label="Add filter coffee"
              >
                {pair ? '✓' : '+'}
              </button>
            </div>
          )}
        </div>
        <div className="foot">
          <div className="step">
            <button onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
            <span>{qty}</span>
            <button onClick={() => setQty((q) => Math.min(20, q + 1))}>+</button>
          </div>
          <button className="btn-benne" onClick={() => onAdd(line, pair)} data-testid="add-to-order">
            <span>{editing ? 'Update order' : 'Add to order'}</span>
            <span className="amt">₹{total}</span>
          </button>
        </div>
      </div>
    </>
  );
}
