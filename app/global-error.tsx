'use client';
import './globals.css';
import { Recover } from '@/components/Recover';

// The same, for an error in the page shell itself (Next.js replaces the whole document here).
export default function GlobalError({ error }: { error: Error }) {
  return (
    <html lang="en" data-theme="light">
      <body>
        <Recover error={error} />
      </body>
    </html>
  );
}
