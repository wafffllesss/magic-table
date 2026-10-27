import type { Page } from '@playwright/test';
import { expect, test, imageBytes } from './fixtures';

async function harness(page: Page, { width = 100, left = 30, playmat = false, inspection = false } = {}) {
  const component = await (await page.request.get('/src/components/CardTile.vue')).text();
  const runtime = component.match(/from ["']([^"']*\/vue\.js[^"']*)["']/)![1];
  await page.route('**/adaptive-image-harness', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><link rel="stylesheet" href="/src/style.css"></head><body><script type="module">
    import { createApp, h, ref } from '${runtime}';
    import CardTile from '/src/components/CardTile.vue';
    import PlaymatArt from '/src/components/PlaymatArt.vue';
    import { scheduleImageMeasurements } from '/src/services/imageVisibility.ts';
    const width = ref(${width}), left = ref(${left}), inspection = ref(${inspection});
    const card = ref({ id:'adaptive', cardId:'adaptive', face:0, faceDown:false, card:{ id:'adaptive', name:'Adaptive // Back', image_uris:undefined, card_faces:[
      {name:'Adaptive',image_uris:{small:'https://cards.scryfall.io/small/adaptive.jpg',normal:'https://cards.scryfall.io/normal/adaptive.jpg',large:'https://cards.scryfall.io/large/adaptive.jpg'}},
      {name:'Back',image_uris:{small:'https://cards.scryfall.io/small/back.jpg'}}
    ] } });
    const host = document.createElement('div'); document.body.append(host);
    const app = createApp({ setup: () => () => h('div', {id:'fixture',style:{position:'fixed',top:'30px',left:left.value+'px',width:width.value+'px',height:width.value*${playmat ? '9/16' : '204/146'}+'px'}}, [
      ${playmat ? "h(PlaymatArt, {id:'azorius'})" : "h(CardTile, {card:card.value,inspection:inspection.value,style:{width:'100%',height:'100%'}})"}
    ]) }); app.mount(host);
    window.fixture = {width,left,card,inspection,measure:scheduleImageMeasurements,unmount:()=>app.unmount()};
  </script></body></html>` }));
  await page.goto('/adaptive-image-harness');
  await expect(page.locator('#fixture')).toBeAttached();
}

test('waits for visibility, upgrades after a stable projection, and never downgrades during zoom', async ({ page }) => {
  const requests: string[] = [];
  await page.route('https://cards.scryfall.io/**', route => { requests.push(route.request().url()); return route.fulfill({ contentType: 'image/png', body: imageBytes }); });
  await harness(page, { left: 2000 });
  await page.waitForTimeout(300); expect(requests).toEqual([]);
  await page.evaluate(() => { (window as any).fixture.left.value = 30; });
  const tile = page.locator('.card-tile');
  await expect(tile).toHaveAttribute('data-image-width', '146');
  await page.evaluate(() => { document.querySelector('#fixture')!.setAttribute('style', 'position:fixed;top:30px;left:30px;width:100px;height:140px;transform:scale(2);transform-origin:top left'); (window as any).fixture.measure(); });
  await expect(tile).toHaveAttribute('data-image-width', '488');
  await page.evaluate(() => { (window as any).fixture.width.value = 550; });
  await expect(tile).toHaveAttribute('data-image-width', '672');
  await page.evaluate(() => { (window as any).fixture.width.value = 80; });
  await page.waitForTimeout(400);
  await expect(tile).toHaveAttribute('data-image-width', '672');
  expect(requests.map(uri => new URL(uri).pathname.split('/')[1])).toEqual(['small', 'normal', 'large']);
});

test('keeps the previous image during download and decode failures, then releases it on face change', async ({ page }) => {
  let finish!: () => Promise<void>;
  await page.route('https://cards.scryfall.io/normal/**', async route => {
    await new Promise<void>(resolve => { finish = async () => { resolve(); }; });
    await route.fulfill({ contentType: 'image/png', body: Buffer.from('undecodable image') });
  });
  await harness(page);
  const image = page.locator('#fixture img');
  await expect(image).toHaveAttribute('src', /^blob:/);
  const small = await image.getAttribute('src');
  await page.evaluate(() => { (window as any).fixture.inspection.value = true; });
  await expect.poll(() => Boolean(finish)).toBe(true);
  await expect(image).toHaveAttribute('src', small!);
  await finish(); await page.waitForTimeout(300);
  await expect(image).toHaveAttribute('src', small!);
  await expect(page.locator('.card-tile')).toHaveAttribute('data-image-width', '146');
  await page.evaluate(() => { (window as any).fixture.card.value.face = 1; });
  await expect.poll(() => image.getAttribute('src')).not.toBe(small);
  expect(await page.evaluate(async url => { try { await fetch(url!); return false; } catch { return true; } }, small)).toBe(true);
  await page.evaluate(() => { (window as any).fixture.card.value.faceDown = true; });
  await expect(image).toHaveCount(0);
});

test('discards obsolete upgrades after a face change', async ({ page }) => {
  let finish!: () => void;
  await page.route('https://cards.scryfall.io/normal/**', async route => {
    await new Promise<void>(resolve => { finish = resolve; });
    await route.fulfill({ contentType: 'image/png', body: imageBytes }).catch(() => {});
  });
  await harness(page, { inspection: true });
  await expect.poll(() => Boolean(finish)).toBe(true);
  await page.evaluate(() => { (window as any).fixture.card.value.face = 1; });
  await expect(page.locator('.card-tile')).toHaveAttribute('data-image-width', '146');
  await expect(page.locator('#fixture img')).toHaveAttribute('alt', 'Back');
  const back = await page.locator('#fixture img').getAttribute('src');
  finish(); await page.waitForTimeout(250);
  await expect(page.locator('#fixture img')).toHaveAttribute('src', back!);
});

test('loads a playmat thumbnail first and preserves it if the full image fails', async ({ page }) => {
  const paths: string[] = [];
  await page.route('**/playmats/**', route => {
    paths.push(new URL(route.request().url()).pathname);
    return route.request().url().endsWith('-thumb.webp') ? route.fulfill({ contentType: 'image/png', body: imageBytes }) : route.fulfill({ status: 503, body: '' });
  });
  await harness(page, { width: 200, playmat: true });
  await expect(page.locator('.adaptive-playmat')).toHaveAttribute('data-image-width', '320');
  expect(paths).toEqual(['/playmats/azorius-thumb.webp']);
  const thumb = await page.locator('#fixture img').getAttribute('src');
  // No retry delay is needed to verify keeping the thumbnail while the upgrade is pending.
  await page.evaluate(() => { (window as any).fixture.width.value = 500; });
  await expect.poll(() => paths.includes('/playmats/azorius.webp')).toBe(true);
  await expect(page.locator('#fixture img')).toHaveAttribute('src', thumb!);
  await page.evaluate(() => { (window as any).fixture.unmount(); });
});

test('upgrades playmats to the full image when their projected size requires it', async ({ page }) => {
  await harness(page, { width: 200, playmat: true });
  await expect(page.locator('.adaptive-playmat')).toHaveAttribute('data-image-width', '320');
  await page.evaluate(() => { (window as any).fixture.width.value = 500; });
  await expect(page.locator('.adaptive-playmat')).toHaveAttribute('data-image-width', '1600');
  await page.evaluate(() => { (window as any).fixture.width.value = 200; });
  await page.waitForTimeout(350);
  await expect(page.locator('.adaptive-playmat')).toHaveAttribute('data-image-width', '1600');
});
