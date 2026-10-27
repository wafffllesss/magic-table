import { expect, test } from './fixtures';
import { preconFixtureDecks } from '../tests/fixtures/precons';

test('detects the device language, applies and persists an explicit choice, and tracks language changes in automatic mode', async ({ page }) => {
  await page.goto('/');
  const selector = page.locator('.language-selector select');
  await expect(selector).toBeVisible();
  await expect(page.locator('.entry-header .language-selector')).toHaveCount(1);
  await expect(page.getByLabel('Seu nome', { exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
  await expect(page).toHaveTitle('Meu Magic · Commander online');
  await expect(page.locator('.entry-header .table-brand')).toContainText('Meu Magic');

  await selector.selectOption('en');
  await expect(page.getByLabel('Your name', { exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page).toHaveTitle('My Magic · Online Commander');
  await expect(page.locator('.entry-header .table-brand')).toContainText('My Magic');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', 'A shared table for playing Commander online.');

  await page.reload();
  await expect(page.getByLabel('Your name', { exact: true })).toBeVisible();
  await expect(selector).toHaveValue('en');

  await selector.selectOption('auto');
  await expect(page.getByLabel('Seu nome', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(window.navigator, 'languages', { configurable: true, get: () => ['en-US'] });
    window.dispatchEvent(new Event('languagechange'));
  });
  await expect(page.getByLabel('Your name', { exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  const deck = preconFixtureDecks()[0];
  await page.evaluate(async deck => {
    const { localRepository } = await import('/src/services/storage.ts');
    await localRepository.saveDeck(deck);
    await localRepository.setPreference('player-name', 'Lia');
    await localRepository.setPreference('selected-deck-id', deck.id);
  }, deck);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Jogos', exact: true })).toBeVisible();
  await page.locator('.language-selector select').selectOption('en');
  await expect(page.getByRole('heading', { name: 'Games', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Lia · Edit name/ })).toBeVisible();
  await expect(page.locator('.room-browser-header .language-selector')).toHaveCount(1);

  await page.getByRole('button', { name: /Change deck/ }).click();
  await expect(page.locator('.workshop-header .language-selector')).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.locator('.room-browser-header')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const tableSelector = page.locator('.table-topbar .language-selector');
  await expect(tableSelector).toBeVisible();
  const headerBounds = await page.locator('.table-topbar').boundingBox();
  const selectorBounds = await tableSelector.boundingBox();
  expect(headerBounds && selectorBounds).toBeTruthy();
  expect(selectorBounds!.x).toBeGreaterThanOrEqual(headerBounds!.x);
  expect(selectorBounds!.x + selectorBounds!.width).toBeLessThanOrEqual(headerBounds!.x + headerBounds!.width);
});
