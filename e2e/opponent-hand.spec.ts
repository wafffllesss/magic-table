import { expect, test } from '@playwright/test';

const harness = `<!doctype html><html><head><link rel="stylesheet" href="/src/style.css"></head><body><div id="fixture"></div><script type="module">
import { createApp, h, reactive } from '/node_modules/.vite/deps/vue.js';
import GameTable from '/src/components/GameTable.vue';
import {initializeLocale} from '/src/i18n/index.ts';
import {localRepository} from '/src/services/storage.ts';
initializeLocale('pt-BR', ['pt-BR']);
await localRepository.setPreference('hide-table-tutorial', true);
const ids = ['northWest', 'northEast', 'southEast', 'southWest'];
const seats = ids.map(id => ({ id, name: id, status: 'playing', commanderIds: [], library: [], hand: [], mulligans: 0, keptHand: true, life: 40, poison: 0, commanderCasts: {}, commanderDamage: {}, landPlays: 0 }));
const props = reactive({ seatId: 'southWest', spectator: false, playmatIds: {}, online: false, multiplayer: true, onlineSeats: {}, state: { id: 'fan-e2e', revision: 0, phase: 'playing', paused: false, activeSeatId: 'southWest', turn: 1, step: 'Principal pré-combate', seats, cards: {}, hiddenZones: Object.fromEntries(ids.map(id => [id, { hand: 7, library: 90 }])), stack: [], passes: [], log: [], updatedAt: Date.now() } });
window.addEventListener('message', ({ data }) => {
  if (data.type === 'count') props.state.hiddenZones[data.seatId].hand = data.count;
  if (data.type === 'viewer') { props.seatId = data.seatId; props.spectator = data.spectator; }
});
createApp({ setup: () => () => h(GameTable, props) }).mount('#fixture');
</script></body></html>`;

test.beforeEach(async ({ page }) => {
  const component = await (await page.request.get('/src/components/GameTable.vue')).text();
  const runtime = component.match(/from ["']([^"']*\/vue\.js[^"']*)["']/)?.[1];
  expect(runtime).toBeTruthy();
  await page.route('**/opponent-hand-harness', route => route.fulfill({ contentType: 'text/html', body: harness.replace('/node_modules/.vite/deps/vue.js', runtime!) }));
  await page.goto('/opponent-hand-harness');
});

test('renders the exact public count, including disconnected opponents, without card identities', async ({ page }) => {
  await expect(page.locator('.opponent-hand')).toHaveCount(3);
  await expect(page.locator('.seat-place[data-seat="southWest"] .opponent-hand')).toHaveCount(0);
  const hand = page.locator('.seat-place[data-seat="northWest"] .opponent-hand');
  for (const count of [0, 1, 2, 7, 15, 50, 7, 6, 0]) {
    await page.evaluate(count => window.postMessage({ type: 'count', seatId: 'northWest', count }), count);
    await expect(hand.locator('.opponent-hand-card')).toHaveCount(count);
    await expect(hand.locator('.opponent-hand-count')).toHaveText(`${count} na mão`);
    await expect(hand).toHaveAttribute('aria-label', `Mão de northWest: ${count} ${count === 1 ? 'carta' : 'cartas'}`);
  }
  await expect(hand).toHaveCSS('pointer-events', 'none');
  await expect(page.locator('.opponent-hand img, .opponent-hand button, .opponent-hand [data-card-id]')).toHaveCount(0);
  await expect(page.locator('.opponent-hand-card .card-tile-back')).toHaveCount(14);
});

test('anchors outside each playmat and follows the table camera for players and spectators', async ({ page }) => {
  await page.screenshot({ path: 'test-results/opponent-hands-seat.png' });
  for (const seatId of ['northWest', 'northEast', 'southEast', 'southWest']) {
    await page.evaluate(seatId => window.postMessage({ type: 'viewer', seatId, spectator: false }), seatId);
    await expect(page.locator(`.seat-place[data-seat="${seatId}"] .opponent-hand`)).toHaveCount(0);
    await expect(page.locator('.opponent-hand')).toHaveCount(3);
  }
  await page.evaluate(() => window.postMessage({ type: 'viewer', seatId: 'southWest', spectator: true }));
  await expect(page.locator('.opponent-hand')).toHaveCount(4);
  for (const hand of await page.locator('.opponent-hand').all()) {
    expect(await hand.evaluate(element => {
      const mat = element.parentElement!.querySelector('.player-mat') as HTMLElement;
      return (element as HTMLElement).offsetTop - mat.offsetHeight;
    })).toBe(40);
  }
  await page.getByTitle('Visão geral', { exact: true }).click();
  await page.mouse.move(0, 0);
  const expectHandsInFrame = async () => {
    const stage = (await page.locator('.table-stage').boundingBox())!;
    for (const card of await page.locator('.opponent-hand-card, .opponent-hand-count').all()) {
      const bounds = (await card.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(stage.x);
      expect(bounds.y).toBeGreaterThanOrEqual(stage.y);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(stage.x + stage.width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(stage.y + stage.height);
    }
  };
  await expectHandsInFrame();
  await page.screenshot({ path: 'test-results/opponent-hands-overview.png' });
  const camera = page.locator('.camera-scene');
  const before = await camera.getAttribute('style');
  await page.locator('.table-stage').hover();
  await page.mouse.wheel(0, -300);
  await expect(camera).not.toHaveAttribute('style', before!);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTitle('Visão geral', { exact: true }).click();
  await expect(page.locator('.opponent-hand')).toHaveCount(4);
  await expectHandsInFrame();
  await page.screenshot({ path: 'test-results/opponent-hands-mobile.png' });
});
