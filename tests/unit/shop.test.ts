import { describe, expect, it } from 'vitest';
import { financialYear, invoiceNumber } from '@/lib/orders';
import { gstinOk, phonePretty, SHOP } from '@/lib/shop';

// What is printed on every bill. A wrong digit here is a wrong digit on every invoice the shop
// issues, so the numbers are checked against their own rules.
describe('the shop’s details on the bill', () => {
  it('has a GSTIN whose check character is right, registered in the state the shop is in', () => {
    expect(gstinOk(SHOP.gstin)).toBe(true);
    expect(SHOP.gstin.slice(0, 2)).toBe(SHOP.state.code);
    expect(SHOP.address.join(' ')).toContain(SHOP.state.name);
  });

  it('catches a mistyped GSTIN', () => {
    expect(gstinOk('09HQSPM1340E1ZN')).toBe(false); // last character wrong
    expect(gstinOk('09HQSPM1304E1ZM')).toBe(false); // two digits swapped
    expect(gstinOk('09hqspm1340e1zm')).toBe(false);
    expect(gstinOk('')).toBe(false);
  });

  it('has a 14-digit FSSAI number, a 10-digit phone number and a fee date', () => {
    expect(SHOP.fssai.number).toMatch(/^\d{14}$/);
    expect(SHOP.phone).toMatch(/^[6-9]\d{9}$/);
    expect(phonePretty(SHOP.phone)).toBe('+91 74286 71414');
    expect(SHOP.fssai.feePaidUpto).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(SHOP.sac).toBe('9963');
  });
});

describe('invoice numbers', () => {
  it('belong to India’s financial year, April to March, by the date in India', () => {
    expect(financialYear('2026-11-16T10:00:00+05:30')).toBe('26-27');
    expect(financialYear('2027-03-31T23:59:00+05:30')).toBe('26-27');
    expect(financialYear('2027-04-01T00:01:00+05:30')).toBe('27-28');
    expect(financialYear('2027-03-31T19:00:00Z')).toBe('27-28'); // already 1 April in India
    expect(financialYear('2099-12-01T10:00:00+05:30')).toBe('99-00');
  });

  it('are never longer than the sixteen characters a GST invoice number may have', () => {
    expect(invoiceNumber('26-27', 1)).toBe('B14/26-27/000001');
    expect(invoiceNumber('26-27', 999_999)).toHaveLength(16);
    expect(invoiceNumber('26-27', 123)).toMatch(/^[A-Z0-9/-]{1,16}$/);
  });
});
