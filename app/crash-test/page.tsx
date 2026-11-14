'use client';
// For the automatic test of crash recovery (tests/e2e/resilience.spec.ts): this page throws while
// drawing itself when asked to with ?boom=1. It shows nothing and does nothing otherwise.
import { useEffect, useState } from 'react';

export default function CrashTest() {
  const [boom, setBoom] = useState(false);
  useEffect(() => setBoom(new URLSearchParams(window.location.search).has('boom')), []);
  if (boom) throw new Error('crash test');
  return <p data-testid="crash-ok">ok</p>;
}
