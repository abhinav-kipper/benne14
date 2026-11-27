import { describe, expect, it } from 'vitest';
import { isTestMode } from '@/lib/testmode';
import { priceOrder } from '@/lib/pricing';
import { BASE_CATALOG, visibleItems } from '@/lib/menu';

describe('test mode', () => {
  it('is off unless TEST_MODE=1', () => {
    expect(isTestMode({})).toBe(false);
    expect(isTestMode({ VERCEL_ENV: 'production' })).toBe(false);
    expect(isTestMode({ TEST_MODE: '0' })).toBe(false);
    expect(isTestMode({ TEST_MODE: '1' })).toBe(true);
  });

  it('the ₹1 payment test item costs exactly ₹1 with GST and only shows in test mode', () => {
    expect(priceOrder([{ itemId: 'test-1', qty: 1, choices: {}, notes: [] }]).total).toBe(1);
    expect(visibleItems(true, BASE_CATALOG).some((i) => i.id === 'test-1')).toBe(true);
    expect(visibleItems(false, BASE_CATALOG).some((i) => i.id === 'test-1')).toBe(false);
  });
});
