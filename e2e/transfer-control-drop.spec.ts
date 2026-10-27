import { expect, test } from '@playwright/test';

test('asks before transferring a dragged permanent to another playmat', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.evaluate(async () => {
    const vueModuleUrl = performance.getEntriesByType('resource').map(entry => entry.name).find(url => url.includes('/node_modules/.vite/deps/vue.js')) ?? '/node_modules/.vite/deps/vue.js';
    const { createApp } = await import(vueModuleUrl);
    const { default: GameTable } = await import('/src/components/GameTable.vue');
    await (await import('/src/services/storage.ts')).localRepository.setPreference('hide-table-tutorial', true);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;z-index:1000';
    document.body.append(host);
    const seats = ['northWest', 'southWest'].map(id => ({ id, name: id === 'northWest' ? 'Ana' : 'Lia', status: 'playing', commanderIds: [], library: [], hand: [], mulligans: 0, keptHand: true, life: 40, poison: 0, commanderCasts: {}, commanderDamage: {}, landPlays: 0 }));
    const state = { id: 'transfer-e2e', revision: 0, phase: 'playing', paused: false, activeSeatId: 'southWest', turn: 1, step: 'Principal', seats, cards: { fixtureCard: { id: 'fixtureCard', ownerId: 'southWest', controllerId: 'southWest', cardId: 'fixtureCard', zone: 'battlefield', tapped: false, faceDown: false, x: 42, y: 38, counters: {}, card: { id: 'fixtureCard', oracle_id: 'fixtureCard', name: 'Test Forest', layout: 'normal', color_identity: ['G'], keywords: [], mana_cost: '', type_line: 'Basic Land — Forest', oracle_text: '', legalities: {} } } }, stack: [], passes: [], log: [], updatedAt: Date.now() };
    (window as any).transferActions = [];
    createApp(GameTable, { state, seatId: 'southWest', playmatIds: {}, online: false, onActions: (actions: unknown[]) => (window as any).transferActions.push(...actions) }).mount(host);
  });

  const card = page.locator('.mat-southWest .board-card-wrap').first();
  const target = page.locator('.mat-northWest .battlefield-cards');
  const drop = async () => {
    const cardBox = (await card.boundingBox())!;
    const from = { x: cardBox.x + cardBox.width / 2, y: cardBox.y + cardBox.height / 2 };
    const to = await target.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      for (let row = 3; row <= 7; row++) for (let column = 3; column <= 7; column++) {
        const x = bounds.left + bounds.width * column / 10;
        const y = bounds.top + bounds.height * row / 10;
        const zone = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop-zone]');
        if (zone?.dataset.dropZone === 'battlefield' && zone.dataset.seat === 'northWest') return { x, y };
      }
      throw new Error('No visible drop point on the opponent battlefield');
    });
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await expect(page.locator('.mat-northWest')).toHaveClass(/is-drop-hovered/);
    await page.mouse.up();
    return to;
  };

  const to = await drop();
  const prompt = page.getByRole('dialog', { name: 'Passar o controle da carta para Ana?' });
  await expect(prompt).toBeVisible();
  await expect(prompt.getByRole('button', { name: 'Cancelar' })).toBeFocused();
  const promptBox = (await prompt.boundingBox())!;
  expect(Math.abs(promptBox.x - to.x)).toBeLessThan(350);
  expect(Math.abs(promptBox.y - to.y)).toBeLessThan(180);
  await prompt.getByRole('button', { name: 'Cancelar' }).click();
  expect(await page.evaluate(() => (window as any).transferActions)).toEqual([]);

  await drop();
  await expect(prompt).toBeVisible();
  await prompt.getByRole('button', { name: 'Passar controle' }).click();
  expect(await page.evaluate(() => (window as any).transferActions)).toEqual([{ type: 'TRANSFER_CONTROL', cardId: 'fixtureCard', seatId: 'northWest' }]);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.topbar-actions .icon-button[title="Visão geral"]').click();
  await drop();
  await expect(prompt).toBeVisible();
  const mobileBox = (await prompt.boundingBox())!;
  expect(mobileBox.x).toBeGreaterThanOrEqual(0);
  expect(mobileBox.x + mobileBox.width).toBeLessThanOrEqual(390);
  expect(mobileBox.y).toBeGreaterThanOrEqual(0);
  expect(mobileBox.y + mobileBox.height).toBeLessThanOrEqual(844);
  await page.keyboard.press('Escape');
  await expect(prompt).toHaveCount(0);
});
