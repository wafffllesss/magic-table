import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import { fixtureDecks } from '../tests/fixtures/scryfall';

// Replay the previous image lifecycle without changing application files. This
// keeps both sides on the exact same table even when starter manifests change.
const legacyImages = `
const pendingImages = new Map();
scryfall.image = async function(card, size='small', face=0) {
  const uri = card.image_uris?.[size] ?? card.card_faces?.[face]?.image_uris?.[size];
  if (!uri) return;
  const key = JSON.stringify([card.id, face, size, uri]);
  try {
    const cached = await localRepository.getImage(key);
    if (cached) return URL.createObjectURL(cached);
    let pending = pendingImages.get(key);
    if (!pending) {
      pending = this.request(uri, undefined, undefined, 'image/jpeg,image/png,image/webp').then(async blob => {
        await localRepository.putImage(key, blob); return blob;
      }).finally(() => pendingImages.delete(key));
      pendingImages.set(key, pending);
    }
    return URL.createObjectURL(await pending);
  } catch { return undefined; }
};
localRepository.getImage = async function(id) {
  const database = await this.getDB(); const cached = await database.get('images',id);
  if (cached) { cached.accessedAt=Date.now(); await database.put('images',cached); return cached.blob; }
};
localRepository.putImage = async function(id,blob) {
  const database=await this.getDB();
  await database.put('images',{id,blob,size:blob.size,cachedAt:Date.now(),accessedAt:Date.now()});
  await Promise.all([database.getAll('images'),database.getAll('cards')]);
  return true;
};
CardTile.setup = props => {
  const imageUrl=ref(''); let objectUrl='', request=0;
  const definition=computed(()=>props.definition??props.card?.card);
  watch(()=>JSON.stringify([definition.value?.id,definition.value?.image_uris,definition.value?.card_faces?.map(face=>face.image_uris),props.card?.face,props.card?.faceDown,props.compact]),async()=>{
    const current=++request; if(objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl='';imageUrl.value='';
    if(!definition.value||props.card?.faceDown) return;
    const url=await scryfall.image(definition.value,props.compact?'small':'normal',props.card?.face??0);
    if(current!==request) {if(url) URL.revokeObjectURL(url);return;}
    imageUrl.value=url??'';objectUrl=url??'';
  },{immediate:true});
  onBeforeUnmount(()=>{request++;if(objectUrl) URL.revokeObjectURL(objectUrl);});
  return ()=>h('span',{class:['card-tile',{compact:props.compact}]},imageUrl.value&&!props.card?.faceDown
    ?h('img',{src:imageUrl.value,alt:definition.value?.name,loading:'lazy',draggable:false})
    :h('span',{class:'card-tile-fallback'},definition.value?.name??'M / T'));
};
PlaymatArt.setup=props=>()=>h('img',{src:'/playmats/'+props.id+'.webp',alt:''});
`;

// Opt in: IMAGE_BENCHMARK=before|after pnpm exec playwright test images-benchmark
// The same generated JPEGs and fixture table are used in both revisions.
test('measures image traffic and long tasks on the fixture table', async ({ page }) => {
  test.skip(!process.env.IMAGE_BENCHMARK, 'Opt-in performance comparison');
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    let seed = 12345;
    (window as any).resetImageRandom = () => { seed = 12345; };
    const original = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = ((array: any) => {
      if (!(array instanceof Uint32Array) || array.length !== 1) return original(array);
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      array[0] = seed; return array;
    }) as typeof crypto.getRandomValues;
    (window as any).imageLongTasks = [];
    new PerformanceObserver(list => {
      (window as any).imageLongTasks.push(...list.getEntries().map(entry => ({ start: entry.startTime, duration: entry.duration })));
    }).observe({ type: 'longtask', buffered: true });
  });
  const component = await (await page.request.get('/src/components/CardTile.vue')).text();
  const runtime = component.match(/from ["']([^"']*\/vue\.js[^"']*)["']/)![1];
  await page.route('**/image-benchmark-assets', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
  await page.goto('/image-benchmark-assets');
  const samples = await page.evaluate(() => Object.fromEntries([['small', 146], ['normal', 488], ['large', 672]].map(([size, width]) => {
    const canvas = document.createElement('canvas'); canvas.width = Number(width); canvas.height = Math.round(Number(width) * 204 / 146);
    const context = canvas.getContext('2d')!;
    let seed = 42;
    const pixels = context.createImageData(canvas.width, canvas.height);
    for (let index = 0; index < pixels.data.length; index += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      pixels.data[index] = seed & 255; pixels.data[index + 1] = (seed >> 8) & 255; pixels.data[index + 2] = (seed >> 16) & 255; pixels.data[index + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    return [size, canvas.toDataURL('image/jpeg', 0.65).split(',')[1]];
  })));
  let requests: Record<string, number> = {}; let bytes = 0; let lastImageResponseAt = 0;
  await page.route('https://cards.scryfall.io/**', route => {
    const size = new URL(route.request().url()).pathname.split('/')[1];
    const body = Buffer.from(samples[size] ?? samples.small, 'base64');
    requests[size] = (requests[size] ?? 0) + 1; bytes += body.length;
    lastImageResponseAt = Date.now();
    return route.fulfill({ contentType: 'image/jpeg', body });
  });
  await page.route('**/image-benchmark-harness', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><link rel="stylesheet" href="/src/style.css"></head><body><div id="app"></div><script type="module">
    import {createApp,h,ref,computed,watch,onBeforeUnmount} from '${runtime}';
    import GameTable from '/src/components/GameTable.vue';
    import CardTile from '/src/components/CardTile.vue';
    import PlaymatArt from '/src/components/PlaymatArt.vue';
    import {scryfall} from '/src/services/scryfall.ts';
    import {localRepository} from '/src/services/storage.ts';
    import {startDemoMatch} from '/src/services/demo.ts';
    ${process.env.IMAGE_BENCHMARK === 'before' ? legacyImages : ''}
    const decks=${JSON.stringify(fixtureDecks())};
    await localRepository.putCards([...new Map(decks.flatMap(deck=>deck.entries.map(entry=>[entry.cardId,entry.card]))).values()]);
    const state=ref();
    createApp({setup:()=>()=>state.value?h(GameTable,{state:state.value,seatId:'southWest',playmatIds:{},online:false}):h('button',{id:'start-fixed',onClick:()=>{window.resetImageRandom();state.value=startDemoMatch('Lia',decks);}},'Start fixed table')}).mount('#app');
  </script></body></html>` }));
  const results = [];
  for (const phase of ['cold', 'warm']) {
    requests = {}; bytes = 0; lastImageResponseAt = 0;
    if (phase === 'warm') await page.reload(); else await page.goto('/image-benchmark-harness');
    await expect(page.locator('#start-fixed')).toBeVisible();
    await page.evaluate(() => { (window as any).imageLongTasks = []; });
    const started = Date.now();
    await page.locator('#start-fixed').click();
    await expect(page.locator('.player-mat')).toHaveCount(4);
    await page.waitForTimeout(7000);
    const initial = { requests: { ...requests }, bytes, lastImageRequestMs: lastImageResponseAt ? lastImageResponseAt - started : null };
    await page.locator('.table-stage').evaluate(stage => {
      for (let step = 0; step < 12; step++) stage.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(2000);
    const tasks = await page.evaluate(() => (window as any).imageLongTasks as { duration: number }[]);
    if (phase === 'warm') await page.screenshot({ path: `.cache/image-benchmark-${process.env.IMAGE_BENCHMARK}.png` });
    results.push({ phase, initial, afterZoom: { requests, bytes }, longTasks: tasks.length, longTaskMs: tasks.reduce((sum, task) => sum + task.duration, 0), elapsedMs: Date.now() - started });
  }
  await mkdir('.cache', { recursive: true });
  await writeFile(`.cache/image-benchmark-${process.env.IMAGE_BENCHMARK}.json`, JSON.stringify({ fixture: 'same fixed decks and seeded table, deterministic JPEGs, 1280x720, 7s initial + 2s zoom; before replays original image component, serial queue and blob cache scans', results }, null, 2));
});
