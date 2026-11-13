import type { Metadata, Viewport } from 'next';
import { Big_Shoulders, Familjen_Grotesk } from 'next/font/google';
import './globals.css';

// latin-ext carries the ₹ glyph; without it the browser drew ₹ from a fallback font and it looked odd.
const display = Big_Shoulders({ subsets: ['latin', 'latin-ext'], weight: ['600', '700', '800', '900'], variable: '--font-display', adjustFontFallback: false });
const body = Familjen_Grotesk({ subsets: ['latin', 'latin-ext'], weight: ['400', '500', '600', '700'], variable: '--font-body' });

export const metadata: Metadata = {
  title: 'Benne 14',
  description: 'Authentic Bangalore Dosa — order here',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Benne 14' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#FBF7EF',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
