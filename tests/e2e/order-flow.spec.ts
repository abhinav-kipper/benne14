import { expect, test, type Page } from '@playwright/test';

const PIN = '2468';
const staff = async (page: Page) => page.addInitScript((pin) => localStorage.setItem('benne14.staffPin', pin), PIN);

test('kiosk → kitchen → TV board → phone bill', async ({ browser }) => {
  // Kiosk: Ghee Podi Benne Dosa with extra benne + two filter coffees, pay by UPI.
  const kiosk = await browser.newPage({ viewport: { width: 800, height: 1280 } });
  await kiosk.goto('/kiosk');
  await kiosk.getByTestId('takeaway').click();
  await kiosk.getByTestId('hero').click();
  await kiosk.getByTestId('addon-benne').click();
  await kiosk.getByTestId('add-to-order').click();
  await kiosk.getByTestId('item-filter-coffee').click();
  await kiosk.getByTestId('sheet').getByRole('button', { name: '+' }).last().click(); // quantity 2
  await kiosk.getByTestId('add-to-order').click();
  await kiosk.getByTestId('cartbar').click();
  await expect(kiosk.getByTestId('cart-total')).toHaveText('₹330'); // 196 + 118, + 5% GST
  await kiosk.getByPlaceholder('Your name').fill('Rahul');
  await kiosk.getByTestId('continue-to-pay').click();
  await kiosk.getByTestId('pay-upi').click();
  await kiosk.getByTestId('simulate-paid').click();
  const token = (await kiosk.getByTestId('token').locator('.num').textContent())!;
  expect(token).toMatch(/^A-\d{3}$/);

  // Kitchen: the chit lands on the rail; start, then ready.
  const kitchen = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await staff(kitchen);
  await kitchen.goto('/kitchen');
  const chit = kitchen.getByTestId(`chit-${token}`);
  await expect(chit).toBeVisible({ timeout: 5000 });
  await expect(chit).toContainText('घी पोडी बेन्ने डोसा');
  await expect(chit).toContainText('+ बेन्ने');
  await kitchen.getByTestId(`go-${token}`).click(); // शुरू करो
  await expect(kitchen.getByTestId(`go-${token}`)).toContainText('तैयार');

  // Board shows it cooking, then ready with the name.
  const board = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await board.goto('/board');
  await expect(board.getByTestId(`board-prep-${token}`)).toBeVisible({ timeout: 5000 });
  await kitchen.getByTestId(`go-${token}`).click(); // तैयार
  await expect(board.getByTestId('board-hero')).toContainText(token, { timeout: 5000 });
  await expect(board.getByTestId('board-hero')).toContainText('Rahul');

  // Phone bill reflects it.
  const id = await kiosk.evaluate(() => document.querySelector('.receipt img')?.getAttribute('src')?.match(/r%2F([0-9a-f-]{36})/)?.[1]);
  expect(id).toBeTruthy();
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await phone.goto(`/r/${id}`);
  await expect(phone.getByTestId('receipt-status')).toContainText('तैयार');
  await expect(phone.locator('.tot b')).toHaveText('₹330');
});

test('cash order waits for the counter before reaching the rail', async ({ browser }) => {
  const kiosk = await browser.newPage({ viewport: { width: 800, height: 1280 } });
  await kiosk.goto('/kiosk');
  await kiosk.getByTestId('dine-in').click();
  await kiosk.getByTestId('item-medu-vada').click();
  await kiosk.getByTestId('add-to-order').click();
  await kiosk.getByTestId('cartbar').click();
  await kiosk.getByTestId('continue-to-pay').click();
  await kiosk.getByTestId('pay-cash').click();
  const token = (await kiosk.getByTestId('token').locator('.num').textContent())!;
  await expect(kiosk.locator('.paid.due')).toContainText('at the counter');

  const kitchen = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await staff(kitchen);
  await kitchen.goto('/kitchen');
  await expect(kitchen.locator('.plate.due', { hasText: token })).toBeVisible({ timeout: 5000 });
  await expect(kitchen.getByTestId(`chit-${token}`)).toHaveCount(0);
  await kitchen.locator('.plate.due', { hasText: token }).getByRole('button').click(); // पैसे मिल गए
  await expect(kitchen.getByTestId(`chit-${token}`)).toBeVisible({ timeout: 5000 });
});

test('status changes need the staff PIN', async ({ request }) => {
  const r = await request.post('/api/orders/00000000-0000-0000-0000-000000000000/status', { data: { to: 'cooking' } });
  expect(r.status()).toBe(401);
});
