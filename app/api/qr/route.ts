import QRCode from 'qrcode';

// QR for this site's own phone-bill links only (/r/<id>), so it can't be used as an open QR generator.
export async function GET(req: Request) {
  const u = new URL(req.url).searchParams.get('u') ?? '';
  let target: URL;
  try { target = new URL(u); } catch { return new Response('Bad link', { status: 400 }); }
  if (target.host !== new URL(req.url).host || !/^\/r\/[0-9a-f-]{36}$/.test(target.pathname)) return new Response('Bad link', { status: 400 });
  const svg = await QRCode.toString(target.toString(), { type: 'svg', margin: 0, color: { dark: '#1C1A15', light: '#00000000' } });
  return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' } });
}
