import Receipt from './Receipt';
import './receipt.css';
import '../../kiosk/kiosk.css';

export const metadata = { title: 'Benne 14 — Your order' };

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Receipt id={id} />;
}
