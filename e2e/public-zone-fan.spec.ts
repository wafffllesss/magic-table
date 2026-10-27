import { expect, test } from './fixtures';

test('fans use the visible felt and advance cards into edge stacks', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const vueUrl = performance.getEntriesByType('resource').map(entry => entry.name).find(url => url.includes('/node_modules/.vite/deps/vue.js')) ?? '/node_modules/.vite/deps/vue.js';
    const { createApp } = await import(vueUrl);
    const { default: GameTable } = await import('/src/components/GameTable.vue');
    await (await import('/src/services/storage.ts')).localRepository.setPreference('hide-table-tutorial', true);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;z-index:1000';
    document.body.append(host);
    const seats = ['northWest', 'southWest'].map(id => ({ id, name: id === 'southWest' ? 'Lia' : 'Yara', status: 'playing', commanderIds: [], library: [], hand: [], mulligans: 0, keptHand: true, life: 40, poison: 0, commanderCasts: {}, commanderDamage: {}, landPlays: 0 }));
    const cards = Object.fromEntries(Array.from({ length: 52 }, (_, index) => {
      const id = `fan-${index}`;
      return [id, { id, ownerId: 'southWest', controllerId: 'southWest', cardId: id, zone: index < 50 ? 'graveyard' : 'exile', tapped: false, faceDown: false, counters: {}, card: { id, oracle_id: id, name: `Fan card ${index}`, layout: 'normal', color_identity: [], keywords: [], mana_cost: '', type_line: 'Creature', oracle_text: '', legalities: {} } }];
    }));
    createApp(GameTable, { state: { id: 'fan-e2e', revision: 0, phase: 'playing', paused: false, activeSeatId: 'southWest', turn: 1, step: 'Principal pré-combate', seats, cards, stack: [], passes: [], log: [], updatedAt: Date.now() }, seatId: 'southWest', playmatIds: {}, online: false }).mount(host);
  });
  const graveyard = page.locator('.table-stage .fan-graveyard');
  const exile = page.locator('.table-stage .fan-exile');
  await page.locator('.seat-place[data-seat="southWest"] .physical-graveyard').evaluate(node => (node as HTMLElement).click());
  await expect(graveyard).toBeVisible();
  await expect.poll(() => graveyard.evaluate(node => node.getBoundingClientRect().width)).toBeGreaterThan(280);
  await expect(graveyard.locator('.public-zone-fan-stack.is-after')).toBeVisible();
  await expect(graveyard.locator('.public-zone-fan-stack.is-before')).toHaveCount(0);
  const firstCards = await graveyard.locator('.public-zone-fan-card').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-fan-card-index')));
  expect(firstCards.length).toBeLessThan(50);
  await graveyard.getByRole('button', { name: 'Mostrar próxima carta' }).click();
  await expect(graveyard.locator('.public-zone-fan-stack.is-before')).toBeVisible();
  expect(await graveyard.locator('.public-zone-fan-card').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-fan-card-index')))).not.toEqual(firstCards);
  await graveyard.dispatchEvent('wheel', { deltaY: 100 });
  await expect(graveyard.locator('.public-zone-fan-stack.is-before > b')).toHaveText('2');
  await graveyard.dispatchEvent('wheel', { deltaY: -100 });
  await expect(graveyard.locator('.public-zone-fan-stack.is-before > b')).toHaveText('1');
  await graveyard.locator('.public-zone-fan-card').first().focus();
  await page.keyboard.press('End');
  await expect(graveyard.locator('.public-zone-fan-card[data-fan-card-index="49"]')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(graveyard.locator('.public-zone-fan-card[data-fan-card-index="0"]')).toBeFocused();
  await page.locator('.seat-place[data-seat="southWest"] .physical-exile').evaluate(node => (node as HTMLElement).click());
  await expect(exile.locator('.public-zone-fan-card')).toHaveCount(2);
  await graveyard.locator('.public-zone-fan-card').first().evaluate(node => (node as HTMLElement).click());
  await expect(page.locator('.shared-card-inspection')).toBeVisible();
  await page.getByRole('button', { name: 'Fechar inspeção', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.topbar-actions .icon-button').first().click();
  await expect.poll(() => graveyard.evaluate(node => {
    const fan = node.getBoundingClientRect();
    const stage = node.closest('.table-stage')!.getBoundingClientRect();
    return fan.left >= stage.left - 2 && fan.right <= stage.right + 2;
  })).toBe(true);
  const display = graveyard.locator('.public-zone-fan-display');
  await display.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 220, clientY: 450 });
  await display.dispatchEvent('pointerup', { pointerType: 'touch', clientX: 150, clientY: 450 });
  await expect(graveyard.locator('.public-zone-fan-stack.is-before > b')).toHaveText('1');
});
