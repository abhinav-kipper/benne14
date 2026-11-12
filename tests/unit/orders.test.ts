import { describe, expect, it } from 'vitest';
import { formatToken, plainToken } from '@/lib/orders';

describe('order numbers', () => {
  it('are plain numbers', () => {
    expect(formatToken(7)).toBe('7');
    expect(formatToken(142)).toBe('142');
  });

  it('show old "A-042" tokens as plain numbers', () => {
    expect(plainToken('A-042')).toBe('42');
    expect(plainToken('A-100')).toBe('100');
    expect(plainToken('A-000')).toBe('0');
    expect(plainToken('42')).toBe('42');
  });
});
