import { expect, test } from '@playwright/test';

test('battlefield cards follow their displayed vertical position, including selection and movement', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const vueUrl = performance.getEntriesByType('resource').map(entry => entry.name).find(url => url.includes('/node_modules/.vite/deps/vue.js')) ?? '/node_modules/.vite/deps/vue.js';
    const { createApp, reactive } = await import(vueUrl);
    const { default: GameTable } = await import('/src/components/GameTable.vue');
    const { localRepository } = await import('/src/services/storage.ts');
    await localRepository.setPreference('hide-table-tutorial', true);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;z-index:1000';
    document.body.append(host);
    const seat = { id: 'southWest', name: 'Lia', status: 'playing', commanderIds: [], library: [], hand: [], mulligans: 0, keptHand: true, life: 40, poison: 0, commanderCasts: {}, commanderDamage: {}, landPlays: 0 };
    const card = (id: string, y: number) => ({ id, ownerId: 'southWest', controllerId: 'southWest', cardId: id, zone: 'battlefield', tapped: false, faceDown: false, x: 50, y, counters: {}, card: { id, oracle_id: id, name: id, layout: 'normal', color_identity: ['G'], keywords: [], mana_cost: '', type_line: 'Basic Land — Forest', oracle_text: '', legalities: {} } });
    // Insert the lower card first to ensure source order does not determine depth.
    const state = reactive({ id: 'layers-e2e', revision: 0, phase: 'playing', paused: false, activeSeatId: 'southWest', turn: 1, step: 'Principal', seats: [seat], cards: { lower: card('lower', 45), upper: card('upper', 40) }, stack: [], passes: [], log: [], updatedAt: Date.now() });
    (window as any).layerTestState = state;
    createApp(GameTable, { state, seatId: 'southWest', playmatIds: {}, online: false }).mount(host);
  });
  const upper = page.locator('.mat-southWest .board-card-wrap[data-card-id="upper"]');
  const lower = page.locator('.mat-southWest .board-card-wrap[data-card-id="lower"]');
  await expect(upper).toHaveCSS('z-index', '1');
  await expect(lower).toHaveCSS('z-index', '2');
  await upper.dispatchEvent('click');
  await upper.dispatchEvent('pointerover');
  await expect(upper).toHaveClass(/is-picked/);
  await expect(upper).toHaveCSS('z-index', '1');
  await lower.click();
  await expect(lower).toHaveClass(/is-picked/);
  await page.evaluate(() => { (window as any).layerTestState.cards.upper.y = 50; });
  await expect(upper).toHaveCSS('z-index', '2');
  await expect(lower).toHaveCSS('z-index', '1');
  await page.evaluate(() => { (window as any).layerTestState.cards.upper.y = 45; });
  await expect(lower).toHaveCSS('z-index', '1');
  await expect(upper).toHaveCSS('z-index', '2');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => {
    (window as any).layerTestState.cards.lower.y = 20;
    (window as any).layerTestState.cards.upper.y = 60;
    (window as any).layerTestState.cards.upper.tapped = true;
  });
  await expect(upper.locator('.card-pose')).toHaveClass(/is-tapped/);
  const hitAreas = await upper.evaluate(node => {
    const wrapper = node.getBoundingClientRect();
    const pose = node.querySelector('.card-pose')!.getBoundingClientRect();
    const at = (x: number, y: number) => document.elementFromPoint(x, y)?.closest('[data-card-id]')?.getAttribute('data-card-id');
    return {
      formerTop: at(wrapper.x + wrapper.width / 2, wrapper.y + wrapper.height * .05),
      rotatedSide: at(pose.x + pose.width * .95, pose.y + pose.height / 2),
    };
  });
  expect(hitAreas.formerTop).not.toBe('upper');
  expect(hitAreas.rotatedSide).toBe('upper');
});
