import { preconFixtureDecks } from '../tests/fixtures/precons';
import { startLocalDemo } from './navigation';
import { expect, test } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async decks => {
    const { localRepository } = await import('/src/services/storage.ts');
    for (const deck of decks) await localRepository.saveDeck(deck);
  }, preconFixtureDecks());
});

test('tutorial explains controls, suppresses shortcuts and persists the preference', async ({ page }) => {
  await startLocalDemo(page, true);
  const tutorial = page.getByRole('dialog', { name: 'Olhe ao redor' });
  await expect(tutorial).toBeVisible();
  await expect(tutorial.getByRole('button', { name: 'Fechar tutorial' })).toBeFocused();
  await page.keyboard.press('Control+d');
  await expect(page.locator('.own-hand-fan .fan-card')).toHaveCount(7);
  for (const title of ['Aproxime a mesa', 'Inspecione uma carta', 'Abra as opções', 'Vire uma carta', 'Escolha um alvo', 'Explore os atalhos']) {
    await page.getByRole('button', { name: 'Próximo' }).click();
    await expect(page.getByRole('dialog', { name: title })).toBeVisible();
  }
  await page.getByRole('checkbox', { name: 'Não exibir novamente' }).check();
  await page.getByRole('button', { name: 'Ver atalhos' }).click();
  await expect(page.locator('.help-modal')).toBeVisible();
  await page.getByRole('button', { name: 'Ver tutorial' }).click();
  await expect(page.getByRole('dialog', { name: 'Olhe ao redor' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.tutorial-dialog')).toHaveCount(0);
  await expect.poll(() => page.evaluate(async () => (await import('/src/services/storage.ts')).localRepository.getPreference('hide-table-tutorial'))).toBe(true);
  await page.reload();
  await startLocalDemo(page, true);
  await expect(page.locator('.tutorial-dialog')).toHaveCount(0);
  await page.keyboard.press('?');
  await page.getByRole('button', { name: 'Ver tutorial' }).click();
  await expect(page.getByRole('checkbox', { name: 'Não exibir novamente' })).toBeChecked();
  await page.getByRole('checkbox', { name: 'Não exibir novamente' }).uncheck();
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(async () => (await import('/src/services/storage.ts')).localRepository.getPreference('hide-table-tutorial'))).toBe(false);
  await page.reload();
  await startLocalDemo(page, true);
  await expect(page.getByRole('dialog', { name: 'Olhe ao redor' })).toBeVisible();
});

test('tutorial works on a narrow screen with reduced motion and in English', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(async () => (await import('/src/services/storage.ts')).localRepository.setPreference('language-preference', 'en'));
  await page.reload();
  // Use the same seeded local demo through its localized controls.
  await page.getByLabel('Your name', { exact: true }).fill('Lia');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Choose Forged in Stone', exact: true }).click();
  await page.locator('.room-demo').getByRole('button', { name: 'Play', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Look around' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.tutorial-board')).toHaveCSS('animation-name', 'none');
  await expect(dialog).toBeInViewport();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('checkbox', { name: 'Don’t show again' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});
