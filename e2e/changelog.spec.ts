import { expect, test } from './fixtures';

test('shows release notes before opening the update page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.addInitScript(() => {
    (window as any).openedUpdate = false;
    (window as any).meuMagicDesktop = {
      checkForUpdate: async () => ({ currentVersion: '0.0.5', version: '0.0.6', url: 'https://github.com/wafffllesss/magic-table/releases/tag/v0.0.6', notes: { 'pt-BR': '# Features\n- Modo solo\n<script>bad()</script>' } }),
      openUpdate: async () => { (window as any).openedUpdate = true; },
      onInvite: () => () => {}, onMcpToolCall: () => () => {}, onBeforeQuit: () => () => {},
      onLegacyMigrationEvent: () => () => {}, acknowledgeLegacyMigrationEvent: () => {}, startLegacyMigration: async () => true,
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Baixar atualização' }).click();
  const dialog = page.getByRole('dialog', { name: 'Novidades' });
  await expect(dialog).toContainText('Modo solo');
  await expect(dialog.locator('script')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).openedUpdate)).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await dialog.getByRole('button', { name: /Abrir página de download/ }).click();
  expect(await page.evaluate(() => (window as any).openedUpdate)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});
