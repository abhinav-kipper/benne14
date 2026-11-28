// Shop details shown to customers, printed on the bill, and used to build UPI payment QRs.
// Everything here is public: it is on the shop's board, its bills and its Paytm standee.
export const SHOP = {
  name: 'benne 14',
  tagline: 'Authentic Bangalore Dosa',
  upiId: 'paytm.s3zpul3@pty',
  // Opening hours (24 h, IST), used to lay out the busy-hours charts. A guess until confirmed with
  // the owner; the charts also stretch to cover any order outside these hours.
  hours: { open: 8, close: 23 },

  // What the law asks a food business to print on every bill (docs/tax-invoice.md):
  // name, address and GSTIN of the supplier (CGST Rule 46), and the 14-digit FSSAI number.
  // The address is as it stands on the FSSAI registration certificate.
  address: ['Ground Floor, Shop No. 1, Plot No. 15', 'Shakti Khand 3, Indirapuram', 'Ghaziabad, Uttar Pradesh 201014'],
  state: { name: 'Uttar Pradesh', code: '09' }, // also the first two digits of the GSTIN
  gstin: '09HQSPM1340E1ZM',
  fssai: { number: '22726105001944', feePaidUpto: '2027-08-17' }, // a registration (not a licence)
  phone: '7428671414',
  // Restaurant service: 5% GST (2.5% CGST + 2.5% SGST), no input tax credit. SAC heading 9963.
  sac: '9963',
};

export const phonePretty = (p: string) => `+91 ${p.slice(0, 5)} ${p.slice(5)}`;

// The check character at the end of a GSTIN, so a mistyped number is caught by a test and not by
// the tax office. (Each of the first 14 characters is weighted 1, 2, 1, 2… in base 36.)
export function gstinOk(g: string): boolean {
  const C = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(g)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = C.indexOf(g[i]) * (i % 2 ? 2 : 1);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return C[(36 - (sum % 36)) % 36] === g[14];
}
