import { describe, expect, it } from 'vitest';
import { itemsPhrase, orderedSentence } from '@/lib/wording';

const L = (name: string, qty = 1) => ({ name, qty });

describe('order wording', () => {
  it('names what was ordered', () => {
    expect(itemsPhrase([L('Masala Dosa')])).toBe('Masala Dosa');
    expect(itemsPhrase([L('Masala Dosa', 2), L('Masala Tea')])).toBe('2 Masala Dosas and Masala Tea');
    expect(itemsPhrase([L('Masala Dosa'), L('Udupi Medu Vada'), L('Masala Tea')])).toBe('Masala Dosa, Udupi Medu Vada and Masala Tea');
    expect(itemsPhrase([L('A'), L('B'), L('C'), L('D')])).toBe('A, B and 2 more');
  });

  it('fits the order: coffee-only, dine-in, takeaway, pay at counter', () => {
    const base = { total: 69, payMethod: 'cash' as const, type: 'takeaway' as const };
    expect(orderedSentence({ ...base, status: 'new', lines: [L('Bengaluru Filter Coffee')] }))
      .toBe('Your Bengaluru Filter Coffee is being made fresh. We’ll pack it to take away.');
    expect(orderedSentence({ ...base, type: 'dine_in', status: 'cooking', lines: [L('Thatte Idli', 3)] }))
      .toBe('Your 3 Thatte Idlis are being made fresh. Grab a seat, we’ll call you.');
    expect(orderedSentence({ ...base, status: 'awaiting_cash', lines: [L('Masala Dosa')] }))
      .toBe('Pay ₹69 at the counter and we’ll start your Masala Dosa.');
  });
});
