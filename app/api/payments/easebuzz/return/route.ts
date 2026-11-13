// Where Easebuzz's payment page lands inside its frame when the customer finishes or gives up.
// It decides nothing: the kiosk learns the result from the order itself. This only replaces
// Easebuzz's page with a plain line so the frame doesn't show a stale QR.
const page = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<body style="margin:0;display:grid;place-items:center;height:100vh;font:600 22px system-ui,sans-serif;color:#5c5649;background:#fff">
Checking your payment…</body>`;
const reply = () =>
  new Response(page, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });

export const dynamic = 'force-dynamic';
export const POST = reply; // Easebuzz posts the result here
export const GET = reply;
