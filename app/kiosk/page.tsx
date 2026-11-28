import { Fit } from '@/components/Fit';
import Kiosk from './Kiosk';
import './kiosk.css';
import { isTestMode } from '@/lib/testmode';

// Its own install settings: added to the tablet's home screen it opens here and stays here.
export const metadata = { title: 'benne 14 — Order here', manifest: '/kiosk.webmanifest' };

export default function KioskPage() {
  return (
    <Fit w={800} h={1280}>
      <Kiosk mock={process.env.PAYMENTS === 'mock'} testMode={isTestMode()} />
    </Fit>
  );
}
