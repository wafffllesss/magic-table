import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('starts the local Commander table and provides four seats', async ({ page }) => {
  await expect(page.getByRole('heading', { name: /A partida acontece/ })).toBeVisible();
  await page.getByLabel('COMO PODEMOS TE CHAMAR?').fill('Lia');
  await page.getByRole('button', { name: 'Entrar na mesa' }).click();
  await expect(page.getByText('DEMONSTRAÇÃO LOCAL')).toBeVisible();
  await expect(page.locator('.player-mat')).toHaveCount(4);
  await expect(page.locator('.mat-southWest')).toHaveClass(/is-self/);
  await expect(page.locator('.hand-section .section-heading b')).toHaveText('07');
});

test('supports drawing, selection, delayed card inspection and help shortcuts', async ({ page }) => {
  await page.getByLabel('COMO PODEMOS TE CHAMAR?').fill('Lia');
  await page.getByRole('button', { name: 'Entrar na mesa' }).click();
  const hand = page.locator('.hand-section .section-heading b');
  await expect(hand).toHaveText('07');
  await page.keyboard.press('Control+d');
  await expect(hand).toHaveText('08');
  await page.locator('.hand-card').first().click();
  await expect(page.locator('.selected-card-controls')).toBeVisible();
  await page.locator('.hand-card').first().hover();
  await expect(page.locator('.inspection-overlay')).toBeVisible({ timeout: 3500 });
  await page.keyboard.press('Escape');
  await page.keyboard.press('?');
  await expect(page.locator('.help-modal')).toContainText('CTRL');
  await page.keyboard.press('Escape');
  await expect(page.locator('.help-modal')).toBeHidden();
});

test('keeps the table usable on a narrow desktop-sized window', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('COMO PODEMOS TE CHAMAR?').fill('Lia');
  await page.getByRole('button', { name: 'Entrar na mesa' }).click();
  await expect(page.locator('.game-sidebar')).toBeVisible();
  await expect(page.locator('.table-hub')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sair da mesa' })).toBeVisible();
});

test('renders the 200-object public stress scene within the browser heap budget', async ({ page }) => {
  await page.goto('/?stress=200');
  await page.getByLabel('COMO PODEMOS TE CHAMAR?').fill('Lia');
  await page.getByRole('button', { name: 'Entrar na mesa' }).click();
  await expect(page.locator('.board-card-wrap[data-card-id*="-stress-"]')).toHaveCount(200);
  const heapBytes = await page.evaluate(() => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0);
  expect(heapBytes).toBeGreaterThan(0);
  expect(heapBytes).toBeLessThan(150 * 1024 * 1024);
});
