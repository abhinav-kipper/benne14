import { Fit } from '@/components/Fit';
import Kiosk from './Kiosk';
import './kiosk.css';

export const metadata = { title: 'Benne 14 — Order here' };

export default function KioskPage() {
  return (
    <Fit w={800} h={1280}>
      <Kiosk />
    </Fit>
  );
}
