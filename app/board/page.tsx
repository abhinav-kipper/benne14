import { Fit } from '@/components/Fit';
import Board from './Board';
import './board.css';

export const metadata = { title: 'Benne 14 — Order board' };

export default function BoardPage() {
  return (
    <Fit w={1920} h={1080}>
      <Board />
    </Fit>
  );
}
