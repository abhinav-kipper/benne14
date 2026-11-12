import { describe, expect, it } from 'vitest';
import { isTestMode } from '@/lib/testmode';
import { priceOrder } from '@/lib/pricing';
import { visibleItems } from '@/lib/menu';

describe('test mode', () => {
  it('is on until TEST_MODE=0 (pre-launch default)', () => {
    expect(isTestMode({})).toBe(true);
    expect(isTestMode({ VERCEL_ENV: 'production' })).toBe(true);
    expect(isTestMode({ TEST_MODE: '0' })).toBe(false);
  });

  it('the ₹1 payment test item costs exactly ₹1 with GST and only shows in test mode', () => {
    expect(priceOrder([{ itemId: 'test-1', qty: 1, choices: {}, notes: [] }]).total).toBe(1);
    expect(visibleItems(true).some((i) => i.id === 'test-1')).toBe(true);
    expect(visibleItems(false).some((i) => i.id === 'test-1')).toBe(false);
  });
});
