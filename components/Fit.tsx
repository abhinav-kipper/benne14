'use client';
import { useEffect, useState, type ReactNode } from 'react';

// Renders a fixed-size design (e.g. 800×1280 kiosk) scaled to fit the device, centred.
// The real tablet is the design size, so it renders 1:1 there.
// `stretch`: on a screen wider than the design (a 16:9 monitor showing a 16:10 design) the design
// keeps its height and is given the extra width instead of empty bars left and right; the screen
// inside must lay itself out to 100% width.
export function Fit({
  w,
  h,
  stretch = false,
  children,
}: {
  w: number;
  h: number;
  stretch?: boolean;
  children: ReactNode;
}) {
  const [box, setBox] = useState({ k: 1, x: 0, y: 0, w });
  useEffect(() => {
    const fit = () => {
      const k = Math.min(window.innerWidth / w, window.innerHeight / h);
      const wide = stretch ? Math.max(w, Math.floor(window.innerWidth / k)) : w;
      setBox({ k, w: wide, x: (window.innerWidth - wide * k) / 2, y: (window.innerHeight - h * k) / 2 });
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [w, h, stretch]);
  return (
    <div className="fit-outer">
      <div
        className="fit-inner"
        style={{ width: box.w, height: h, transform: `translate(${box.x}px,${box.y}px) scale(${box.k})` }}
      >
        {children}
      </div>
    </div>
  );
}
