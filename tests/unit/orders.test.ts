import { describe, expect, it } from 'vitest';
import { allGiven, cleanName, formatToken, givenOf, istDay, plainToken, tickProblem, type Order } from '@/lib/orders';

describe('kitchen ticks', () => {
  const order = (given: unknown, status: Order['status'] = 'cooking') =>
    ({ token: '7', status, lines: [{ qty: 3 }, { qty: 1 }], given }) as unknown as Order;
  it('reads one whole number per line, whatever was stored', () => {
    expect(givenOf(order(undefined))).toEqual([0, 0]);
    expect(givenOf(order([2]))).toEqual([2, 0]);
    expect(givenOf(order([9, -4, 5]))).toEqual([3, 0]); // never more than ordered, never below zero
    expect(givenOf(order(['x', 1.7]))).toEqual([0, 1]);
  });
  it('knows when the whole order has gone out', () => {
    expect(allGiven(order([3, 0]))).toBe(false);
    expect(allGiven(order([3, 1]))).toBe(true);
  });
  it('refuses a tick that makes no sense', () => {
    expect(tickProblem(order([]), 0, 3)).toBeNull();
    expect(tickProblem(order([], 'new'), 1, 1)).toBeNull();
    expect(tickProblem(order([]), 0, 4)?.status).toBe(400);
    expect(tickProblem(order([]), 2, 1)?.status).toBe(400);
    expect(tickProblem(order([]), 0, 1.5)?.status).toBe(400);
    expect(tickProblem(order([], 'ready'), 0, 1)?.status).toBe(409);
    expect(tickProblem(order([], 'awaiting_cash'), 0, 1)?.status).toBe(409);
  });
});

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

describe('the shop day (IST)', () => {
  it('turns over at midnight in India, not UTC', () => {
    expect(istDay(new Date('2026-11-12T18:29:59Z'))).toBe('2026-11-12'); // 23:59:59 IST
    expect(istDay(new Date('2026-11-12T18:30:00Z'))).toBe('2026-11-13'); // 00:00 IST: numbers restart at 1
    expect(istDay(new Date('2026-12-31T20:00:00Z'))).toBe('2027-01-01');
  });
});

describe('customer names', () => {
  it('keeps names short and printable', () => {
    expect(cleanName('  Rahul  ')).toBe('Rahul');
    expect(cleanName('Ra\u0000hul\u202e')).toBe('Rahul'); // control and direction-override characters
    expect(cleanName('Anna   Maria')).toBe('Anna Maria');
    expect(cleanName('x'.repeat(40))).toHaveLength(24);
    expect(cleanName('   ')).toBeNull();
    expect(cleanName(42)).toBeNull();
    expect(cleanName('राहुल')).toBe('राहुल'); // any script is fine
  });
});
