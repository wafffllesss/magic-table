import { expect, type Page } from '@playwright/test';

export async function revealHand(page: Page, touch = false): Promise<void> {
  const hand = page.locator('.own-hand-fan');
  const bounds = await hand.boundingBox();
  if (!bounds) throw new Error('A mão precisa estar disponível para expandir.');
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height - 12;
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.move(x, y);
  await expect(hand).toHaveClass(/is-expanded/);
  await expect.poll(() => hand.locator('.own-hand-cards').evaluate(element => getComputedStyle(element).transform)).toBe('matrix(1, 0, 0, 1, 0, 0)');
}

export async function openLibrary(page: Page): Promise<void> {
  await expect(page.locator('.entry-form, .room-browser-shell, .workshop-shell')).toBeVisible();
  if (await page.locator('.entry-form').count()) {
    await page.getByLabel('Seu nome', { exact: true }).fill('Lia');
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  } else if (await page.locator('.room-browser-shell').count()) {
    await page.getByRole('button', { name: /Trocar deck/ }).click();
  }
  await expect(page.locator('.workshop-shell')).toBeVisible();
}

export async function startLocalDemo(page: Page, preserveTutorial = false): Promise<void> {
  if (!preserveTutorial) await page.evaluate(async () => (await import('/src/services/storage.ts')).localRepository.setPreference('hide-table-tutorial', true));
  await expect(page.locator('.entry-form, .room-browser-shell, .workshop-shell')).toBeVisible();
  if (!await page.locator('.room-browser-shell').count()) {
    await openLibrary(page);
    await page.getByRole('button', { name: 'Escolher Forged in Stone', exact: true }).click();
  }
  await page.getByRole('button', { name: 'DEMO', exact: true }).click();
  await expect(page.locator('.player-mat')).toHaveCount(4);
}
