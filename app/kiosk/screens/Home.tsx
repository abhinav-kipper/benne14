'use client';
// Start screen: one tap anywhere begins an order.
import { photoOf } from '@/lib/menu';

export function Home({ onStart }: { onStart: () => void }) {
  const cols = [['masala-dosa', 'medu-vada', 'thatte-idli'], ['mallige-idli', 'ghee-podi-benne-dosa', 'masala-tea'], ['plain-benne-dosa', 'ghee-podi-thatte-idli', 'plain-dosa']];
  return (
    <div className="screen k-home" onClick={onStart}>
      <div className="top">
        <div className="logo">Benne <i>14</i><small>AUTHENTIC BANGALORE DOSA</small></div>
      </div>
      <div className="mosaic">
        {cols.map((c, i) => <div className="col" key={i}>{c.map((id) => <img key={id} src={photoOf(id)} alt="" />)}</div>)}
      </div>
      <div className="copy">
        <h1 className="disp">Fresh off<br />the <em>tawa.</em></h1>
        <div className="tag">Hot and crisp, straight from the tawa to your plate.</div>
      </div>
      <button className="start" data-testid="start">
        <span><b>Tap to order</b><small>Dosas, idli, vada, filter coffee</small></span><span className="arr">→</span>
      </button>
      <div className="foot">Dine in or takeaway, you choose at the end</div>
    </div>
  );
}
