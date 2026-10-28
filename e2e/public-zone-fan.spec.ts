import { expect, test } from './fixtures';

test('displays up to four columns and switches public zones', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
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
  await expect(graveyard.locator('.public-zone-fan-card')).toHaveCount(50);
  await expect(graveyard.locator('.public-zone-fan-grid')).toHaveCSS('grid-template-columns', /.+ .+ .+ .+/);
  expect(await graveyard.evaluate(node => node.scrollHeight <= node.clientHeight)).toBe(true);
  const overlap = await graveyard.locator('.public-zone-fan-card').evaluateAll(nodes => {
    const first = nodes[0].getBoundingClientRect(), second = nodes[1].getBoundingClientRect();
    return second.top > first.top && second.top < first.bottom;
  });
  expect(overlap).toBe(true);
  const offsets = await graveyard.locator('.public-zone-fan-card').evaluateAll(nodes => {
    const first = nodes[0] as HTMLElement, nextColumn = nodes.find(node => (node as HTMLElement).style.gridColumn === '2') as HTMLElement;
    return { first: Number(first.style.gridRow), next: Number(nextColumn.style.gridRow) };
  });
  expect(offsets.first).toBe(6);
  expect(offsets.next).toBe(1);
  const firstColumnCount = await graveyard.locator('.public-zone-fan-card').evaluateAll(nodes => nodes.filter(node => (node as HTMLElement).style.gridColumn === '1').length);
  expect(firstColumnCount).toBe(10);
  await graveyard.locator('.public-zone-fan-card').first().evaluate(node => (node as HTMLElement).click());
  await expect(page.locator('.shared-card-inspection')).toBeVisible();
  await page.getByRole('button', { name: 'Fechar inspeção', exact: true }).click();
  await page.locator('.seat-place[data-seat="southWest"] .physical-exile').evaluate(node => (node as HTMLElement).click());
  await expect(graveyard).toHaveCount(0);
  await expect(exile.locator('.public-zone-fan-card')).toHaveCount(2);
});
