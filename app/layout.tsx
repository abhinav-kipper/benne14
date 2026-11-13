import type { Metadata, Viewport } from 'next';
import './globals.css';

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
    <html lang="en" data-theme="light">
      <head>
        {/* Fonts live in /public/fonts (see globals.css); preload the two every screen uses first. */}
        <link
          rel="preload"
          href="/fonts/big-shoulders-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/familjen-grotesk-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
