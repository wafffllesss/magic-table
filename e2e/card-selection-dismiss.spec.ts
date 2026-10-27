import { expect, test } from '@playwright/test';

test('clears a selected card when clicking outside selectable cards', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.evaluate(async () => {
    const vueModuleUrl = performance.getEntriesByType('resource').map(entry => entry.name).find(url => url.includes('/node_modules/.vite/deps/vue.js')) ?? '/node_modules/.vite/deps/vue.js';
    const { createApp } = await import(vueModuleUrl);
    const { default: GameTable } = await import('/src/components/GameTable.vue');
    const { localRepository } = await import('/src/services/storage.ts');
    await localRepository.setPreference('hide-table-tutorial', true);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;z-index:1000';
    document.body.append(host);
    const seat = { id: 'southWest', name: 'Lia', status: 'playing', commanderIds: [], library: [], hand: [], mulligans: 0, keptHand: true, life: 40, poison: 0, commanderCasts: {}, commanderDamage: {}, landPlays: 0 };
    const card = (id: string, x: number) => ({ id, ownerId: 'southWest', controllerId: 'southWest', cardId: id, zone: 'battlefield', tapped: false, faceDown: false, x, y: 38, counters: {}, card: { id, oracle_id: id, name: id, layout: 'normal', color_identity: ['G'], keywords: [], mana_cost: '', type_line: 'Basic Land — Forest', oracle_text: '', legalities: {} } });
    const state = { id: 'selection-e2e', revision: 0, phase: 'playing', paused: false, activeSeatId: 'southWest', turn: 1, step: 'Principal', seats: [seat], cards: { first: card('first', 35), second: card('second', 60) }, stack: [], passes: [], log: [], updatedAt: Date.now() };
    createApp(GameTable, { state, seatId: 'southWest', playmatIds: {}, online: false }).mount(host);
  });

  const first = page.locator('.mat-southWest .board-card-wrap[data-card-id="first"]');
  const second = page.locator('.mat-southWest .board-card-wrap[data-card-id="second"]');
  await first.click();
  await expect(first).toHaveClass(/is-picked/);
  await second.click();
  await expect(second).toHaveClass(/is-picked/);
  await expect(first).not.toHaveClass(/is-picked/);

  await page.getByRole('button', { name: 'Deck de Lia' }).click();
  await expect(second).not.toHaveClass(/is-picked/);

  await first.click();
  await page.locator('.topbar-actions .settings-top').click();
  await expect(first).not.toHaveClass(/is-picked/);
  await expect(page.getByRole('dialog', { name: 'Configurações' })).toBeVisible();
});
