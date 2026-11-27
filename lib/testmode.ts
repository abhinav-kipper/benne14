// Test mode, for trying everything before launch: a cash order counts as paid at once (straight to
// the kitchen) and a ₹1 "Payment test" item appears for checking real UPI.
// OFF unless TEST_MODE=1 (the shop is going live: customers must never see the test dish). Set
// TEST_MODE=1 on a preview to try a real ₹1 payment; never on the live site.
export function isTestMode(env: Record<string, string | undefined> = process.env): boolean {
  return env.TEST_MODE === '1';
}
