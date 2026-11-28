// The kiosk waits at "Pay by card / Pay cash" until staff confirm the money. This is the staff's
// "Paid" for the order that kiosk is waiting on, so a test can carry on to the order number.
import { expect, type Page } from '@playwright/test';

export async function counterPaid(page: Page) {
  const wait = page.getByTestId('at-counter');
  await expect(wait).toBeVisible();
  const id = await wait.getAttribute('data-order');
  const r = await page.request.post(`/api/orders/${id}/status`, {
    data: { to: 'new' },
    headers: { 'x-staff-pin': '2468' },
  });
  expect(r.ok()).toBe(true);
}
