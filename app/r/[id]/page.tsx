import type { Viewport } from 'next';
import Receipt from './Receipt';
import './receipt.css';
import '../../kiosk/kiosk.css';

// Phone screens may be pinch-zoomed (the kiosk, kitchen and TV stay locked: see app/layout.tsx).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: '#FBF7EF',
};

export const metadata = { title: 'Benne 14 — Your order' };

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Receipt id={id} />;
}
