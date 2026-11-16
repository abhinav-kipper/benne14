'use client';
// A dish's photo in the owner app: what it is now, "Take photo" and "Choose", and the upload.
// Used for the owner's own dishes and for the dishes that came with the app.
import { useRef, useState } from 'react';
import { admin, ApiError } from '@/lib/client';
import type { Ctx } from './shared';

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

export function PhotoField(
  p: Ctx & {
    photo: string | null | undefined; // what to show now
    onPhoto: (url: string) => void; // a new photo has been uploaded
    onError: (message: string | null) => void;
    disabled?: boolean;
    onBusy?: (uploading: boolean) => void;
    hint: string;
    children?: React.ReactNode; // anything more under the buttons (e.g. "use the original photo")
  },
) {
  const [busy, setBusy] = useState(false);
  const take = useRef<HTMLInputElement>(null);
  const choose = useRef<HTMLInputElement>(null);
  const pick = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    p.onBusy?.(true);
    p.onError(null);
    try {
      p.onPhoto((await admin.photo(p.pin, await shrink(f))).url);
    } catch (e) {
      p.onAuthError(e);
      p.onError(e instanceof ApiError ? e.message : 'That photo could not be used. Try another.');
    }
    setBusy(false);
    p.onBusy?.(false);
  };
  const off = busy || !!p.disabled;
  return (
    <div className="field">
      <label>Photo</label>
      <div className="photo">
        {p.photo ? <img src={p.photo} alt="" data-testid="dish-photo" /> : <div className="ph">No photo</div>}
        <div>
          <div className="two">
            <button className="btn o" disabled={off} onClick={() => take.current?.click()}>
              Take photo
            </button>
            <button className="btn o" disabled={off} onClick={() => choose.current?.click()}>
              Choose
            </button>
          </div>
          <div className="was">{busy ? 'Uploading…' : p.hint}</div>
          {p.children}
        </div>
      </div>
      <input
        ref={take}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => pick(e.target.files?.[0])}
      />
      <input
        ref={choose}
        type="file"
        accept="image/*"
        hidden
        data-testid="dish-file"
        onChange={(e) => pick(e.target.files?.[0])}
      />
    </div>
  );
}
