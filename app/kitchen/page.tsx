import { Fit } from '@/components/Fit';
import Kitchen from './Kitchen';
import './kitchen.css';

export const metadata = { title: 'benne 14 — Kitchen' };

export default function KitchenPage() {
  return (
    <Fit w={1280} h={800} stretch>
      <Kitchen />
    </Fit>
  );
}
