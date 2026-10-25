import type { Metadata, Viewport } from 'next';
import { Big_Shoulders, Familjen_Grotesk, Tiro_Devanagari_Hindi } from 'next/font/google';
import './globals.css';

const display = Big_Shoulders({ subsets: ['latin'], weight: ['600', '700', '800', '900'], variable: '--font-display', adjustFontFallback: false });
const body = Familjen_Grotesk({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-body' });
const hi = Tiro_Devanagari_Hindi({ subsets: ['devanagari', 'latin'], weight: '400', style: ['normal', 'italic'], variable: '--font-hi' });

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
    <html lang="en" data-theme="light" className={`${display.variable} ${body.variable} ${hi.variable}`}>
      <body>{children}</body>
    </html>
  );
}
