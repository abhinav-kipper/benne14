'use client';
import { useEffect, useState, type ReactNode } from 'react';

// Renders a fixed-size design (e.g. 800×1280 kiosk) scaled to fit the device, centred.
// The real tablet is the design size, so it renders 1:1 there.
export function Fit({ w, h, children }: { w: number; h: number; children: ReactNode }) {
  const [box, setBox] = useState({ k: 1, x: 0, y: 0 });
  useEffect(() => {
    const fit = () => {
      const k = Math.min(window.innerWidth / w, window.innerHeight / h);
      setBox({ k, x: (window.innerWidth - w * k) / 2, y: (window.innerHeight - h * k) / 2 });
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [w, h]);
  return (
    <div className="fit-outer">
      <div className="fit-inner" style={{ width: w, height: h, transform: `translate(${box.x}px,${box.y}px) scale(${box.k})` }}>
        {children}
      </div>
    </div>
  );
}
