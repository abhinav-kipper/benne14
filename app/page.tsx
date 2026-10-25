import Link from 'next/link';

// Device launcher: open this once on each device and pick its screen (then "Add to home screen").
export default function Home() {
  const screens = [
    { href: '/kiosk', t: 'Kiosk', d: 'Customer tablet at the entrance (portrait)' },
    { href: '/kitchen', t: 'Kitchen', d: 'Cook’s tablet (landscape) · staff PIN' },
    { href: '/board', t: 'Order board', d: 'TV near the counter (1920×1080)' },
  ];
  return (
    <main style={{ maxWidth: 560, margin: '0 auto', padding: '48px 20px' }}>
      <h1 className="disp" style={{ fontSize: 64, lineHeight: 0.85 }}>Benne <span style={{ color: 'var(--benne-fg)' }}>14</span></h1>
      <p style={{ color: 'var(--cream-3)', margin: '10px 0 30px' }}>Pick the screen for this device.</p>
      {screens.map((s) => (
        <Link key={s.href} href={s.href} style={{ display: 'block', padding: '20px 22px', marginBottom: 12, borderRadius: 16, background: 'var(--s1)', border: '1px solid var(--line)', color: 'inherit', textDecoration: 'none' }}>
          <b className="disp" style={{ fontSize: 34 }}>{s.t} →</b>
          <div style={{ color: 'var(--cream-2)', marginTop: 4 }}>{s.d}</div>
        </Link>
      ))}
    </main>
  );
}
