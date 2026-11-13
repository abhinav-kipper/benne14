// Shop details shown to customers and used to build UPI payment QRs.
// The UPI ID is public: it is printed on the shop's Paytm standee.
export const SHOP = {
  name: 'Benne 14',
  upiId: 'paytm.s3zpul3@pty',
  // Opening hours (24 h, IST), used to lay out the busy-hours charts. A guess until confirmed with
  // the owner; the charts also stretch to cover any order outside these hours.
  hours: { open: 8, close: 23 },
};
