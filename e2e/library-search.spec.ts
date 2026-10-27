import { preconFixtureDecks } from '../tests/fixtures/precons';
import { startLocalDemo } from './navigation';
import { expect, test } from './fixtures';

test.use({ locale: 'pt-BR', hasTouch: true });

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`searches the complete library by type at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.evaluate(async decks => {
      const { localRepository } = await import('/src/services/storage.ts');
      for (const deck of decks) await localRepository.saveDeck(deck);
    }, preconFixtureDecks());
    await startLocalDemo(page);
    const handBefore = await page.locator('.own-hand-fan .fan-card').count();
    const opener = page.getByRole('button', { name: 'Buscar na biblioteca' });
    await opener.click();
    await page.setViewportSize(viewport);
    const dialog = page.getByRole('dialog', { name: 'Encontre uma carta.' });
    const input = dialog.getByRole('searchbox');
    await expect(input).toBeFocused();
    const choices = dialog.locator('.library-search-result');
    expect(await choices.count()).toBeGreaterThan(30);
    const columns = dialog.locator('.library-type-column');
    expect(await columns.count()).toBeGreaterThan(2);
    const total = await columns.locator('.library-type-heading > span').allTextContents();
    // The demo starts with seven cards in hand and three permanents on the table.
    expect(total.reduce((sum, value) => sum + Number(value), 0)).toBe(89);
    const geometry = await dialog.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const results = element.querySelector('.library-search-results')!;
      return { left: rect.left, right: rect.right, bottom: rect.bottom, horizontalScroll: results.scrollWidth > results.clientWidth };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(viewport.width);
    expect(geometry.bottom).toBeLessThanOrEqual(viewport.height);
    if (viewport.width < 700) expect(geometry.horizontalScroll).toBe(true);

    // Filter to a basic land so duplicate copies and the destination are exercised.
    await input.fill('Plains');
    const plains = dialog.getByRole('button', { name: /^Plains, \d+ cópia/ });
    await expect(plains).toBeVisible();
    const copies = Number((await plains.getAttribute('aria-label'))!.match(/, (\d+) cópia/)![1]);
    const zoom = dialog.getByRole('button', { name: 'Inspecionar Plains', exact: true });
    if (viewport.width < 700) await zoom.tap();
    else await zoom.press('Enter');
    const inspection = page.getByRole('dialog', { name: 'Inspecionar Plains', exact: true });
    await expect(inspection).toBeVisible();
    await expect(plains).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Escape');
    await expect(inspection).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect(zoom).toBeFocused();
    if (viewport.width >= 700) {
      // The name overlay must allow the card underneath to receive zoom gestures.
      await plains.hover({ position: { x: 40, y: 20 } });
      await page.mouse.wheel(0, -120);
      await expect(inspection).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(inspection).toHaveCount(0);
      await plains.hover({ position: { x: 40, y: 20 } });
      await page.keyboard.press('z');
      await expect(inspection).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(inspection).toHaveCount(0);
    }
    await plains.click({ position: { x: 40, y: 20 } });
    await expect(plains).toHaveAttribute('aria-pressed', 'true');
    await input.fill('no-such-card');
    await expect(dialog.locator('.library-no-results')).toContainText('Nenhuma carta');
    await expect(dialog.locator('.library-selection-count')).toContainText(`${copies} carta(s)`);
    if (copies > 20) await expect(dialog.getByRole('button', { name: 'Concluir e embaralhar' })).toBeDisabled();
    await input.fill('Plains');
    await expect(plains).toHaveAttribute('aria-pressed', 'true');
    await plains.press('Space');
    await expect(plains).toHaveAttribute('aria-pressed', 'false');
    await expect(dialog.getByRole('button', { name: 'Concluir e embaralhar' })).toBeDisabled();
    await input.fill('');
    await choices.first().press('Enter');
    await page.screenshot({ path: `test-results/library-search-${viewport.width}.png` });
    await dialog.getByRole('button', { name: 'Concluir e embaralhar' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.own-hand-fan .fan-card')).toHaveCount(handBefore + 1);
    await expect(opener).toBeFocused();
    await opener.press('Enter');
    await input.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  });
}
