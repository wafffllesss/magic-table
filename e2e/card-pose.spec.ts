import { expect, test } from '@playwright/test';

// Isolated browser fixture: remote snapshots update the same props used by the room component.
const harness = `<!doctype html><html><head><link rel="stylesheet" href="/src/style.css"></head><body><div id="fixture" style="width:84px;height:118px;margin:100px"></div><script type="module">
import { createApp, h, ref } from '/node_modules/.vite/deps/vue.js';
import CardPose from '/src/components/CardPose.vue';
const card = ref({ id:'test', cardId:'test', ownerId:'southWest', controllerId:'southWest', zone:'battlefield', tapped:true, faceDown:false, face:0, x:50, y:50, counters:{}, card:{ id:'test', name:'Frente // Verso', layout:'transform', mana_cost:'', type_line:'Creature', color_identity:[], keywords:[], oracle_text:'', legalities:{}, card_faces:[{name:'Frente',mana_cost:'',type_line:'Creature',oracle_text:''},{name:'Verso',mana_cost:'',type_line:'Creature',oracle_text:''}] } });
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
window.addEventListener('message', event => { if(event.data.type === 'remote-card') card.value = {...card.value, ...event.data.card}; });
createApp({ setup: () => () => h(CardPose, {card:card.value, reducedMotion}) }).mount('#fixture');
</script></body></html>`;

test.beforeEach(async ({ page }) => {
  const component = await (await page.request.get('/src/components/CardPose.vue')).text();
  const runtime = component.match(/from ["']([^"']*\/vue\.js[^"']*)["']/)?.[1];
  expect(runtime).toBeTruthy();
  await page.route('**/card-pose-harness', route => route.fulfill({ contentType: 'text/html', body: harness.replace('/node_modules/.vite/deps/vue.js', runtime!) }));
});

test('animates a remote face change at the midpoint while preserving tap rotation', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-14T12:00:00Z') });
  await page.goto('/card-pose-harness');
  await expect(page.locator('.card-tile-fallback b')).toHaveText('Frente');
  await expect(page.locator('.card-pose')).toHaveClass(/is-tapped/);
  await page.clock.pauseAt(new Date('2026-10-14T12:01:00Z'));
  await page.evaluate(() => window.postMessage({ type: 'remote-card', card: { face: 1 } }));
  await expect(page.locator('.card-face-motion')).toHaveClass(/is-flipping/);
  await page.clock.runFor(100);
  await expect(page.locator('.card-tile-fallback b')).toHaveText('Frente');
  await page.clock.runFor(30);
  await expect(page.locator('.card-tile-fallback b')).toHaveText('Verso');
  await page.clock.runFor(120);
  await expect(page.locator('.card-face-motion')).not.toHaveClass(/is-flipping/);
  await expect(page.locator('.card-pose')).toHaveClass(/is-tapped/);
  await page.evaluate(() => window.postMessage({ type: 'remote-card', card: { tapped: false } }));
  await expect(page.locator('.card-pose')).not.toHaveClass(/is-tapped/);
  await expect(page.locator('.card-tile-fallback b')).toHaveText('Verso');
});

test('changes face immediately when reduced motion is requested', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/card-pose-harness');
  await expect(page.locator('.card-tile-fallback b')).toHaveText('Frente');
  await page.evaluate(() => window.postMessage({ type: 'remote-card', card: { face: 1 } }));
  await expect(page.locator('.card-tile-fallback b')).toHaveText('Verso');
  await expect(page.locator('.card-face-motion')).not.toHaveClass(/is-flipping/);
  await expect(page.locator('.card-pose')).toHaveCSS('transition-duration', '0s');
});
