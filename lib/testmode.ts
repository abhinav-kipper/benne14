// Test mode, for trying everything before launch: a cash order counts as paid at once (straight to
// the kitchen) and a ₹1 "Payment test" item appears for checking real UPI.
// ON by default (owner's choice, pre-launch). Set TEST_MODE=0 in Vercel before real customers.
export function isTestMode(env: Record<string, string | undefined> = process.env): boolean {
  return env.TEST_MODE !== '0';
}
