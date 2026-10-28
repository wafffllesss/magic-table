import { expect, test } from './fixtures';
import { preconFixtureDecks } from '../tests/fixtures/precons';

for (const width of [1280, 390]) test(`profile playmat can be chosen and persists at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 800 });
  await page.goto('/');
  await page.evaluate(async decks => {
    const { localRepository } = await import('/src/services/storage.ts');
    await localRepository.saveDeck(decks[0]);
    await localRepository.setPreference('player-name', 'Lia');
    await localRepository.setPreference('selected-deck-id', decks[0].id);
  }, preconFixtureDecks());
  await page.reload();
  const profile = page.locator('.room-profile');
  await expect(profile).toBeVisible();
  await profile.getByRole('button', { name: 'Personalizar playmat' }).click();
  const preview = page.locator('.playmat-preview');
  const size = await preview.boundingBox();
  expect(size).not.toBeNull();
  expect(size!.width / size!.height).toBeCloseTo(816 / 456, 2);
  await page.locator('.playmat-choice').filter({ hasText: 'Azorius' }).click();
  await page.getByRole('button', { name: 'Aplicar playmat' }).click();
  await expect(profile.locator('.profile-playmat img')).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => page.evaluate(async () => (await import('/src/services/storage.ts')).localRepository.getPreference('playmat-id'))).toBe('azorius');
  await page.reload();
  await expect(profile.locator('.profile-playmat img')).toHaveAttribute('src', /^blob:/);
  await profile.getByRole('button', { name: 'Personalizar playmat' }).click();
  await page.getByLabel('Cor sólida').fill('#aabbcc');
  await page.getByRole('button', { name: 'Aplicar playmat' }).click();
  await expect(profile.locator('.profile-playmat')).toHaveCSS('background-image', /linear-gradient/);
  await expect(profile.getByText('Lia')).toBeVisible();
});
