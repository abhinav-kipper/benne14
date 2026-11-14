'use client';
import { Recover } from '@/components/Recover';

// Any screen that throws while drawing itself lands here instead of a blank page.
export default function ScreenError({ error }: { error: Error }) {
  return <Recover error={error} />;
}
