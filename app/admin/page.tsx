import type { Viewport } from 'next';
import Admin from './Admin';
import './admin.css';

// Phone screens may be pinch-zoomed (the kiosk, kitchen and TV stay locked: see app/layout.tsx).
export const viewport: Viewport = { width: 'device-width', initialScale: 1, maximumScale: 5, userScalable: true, themeColor: '#FBF7EF' };

export const metadata = { title: 'Benne 14 — Owner' };

export default function AdminPage() {
  return <Admin />;
}
