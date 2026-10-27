import { build } from 'vite';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const label = process.argv[process.argv.indexOf('--label') + 1];
if (!['before', 'after'].includes(label)) throw new Error('Use --label before|after');
const destination = path.join(root, '.cache/performance', label);
await mkdir(destination, { recursive: true });
const entry = 'virtual:performance-benchmark';
const source = `
import '/src/style.css';
import {createApp,h,ref,toRaw,nextTick} from 'vue';
import GameTable from '/src/components/GameTable.vue';
import CardInspection from '/src/components/CardInspection.vue';
import {preconFixtureDecks,preconCards} from '/tests/fixtures/precons.ts';
import {startDemoMatch,addStressObjects} from '/src/services/demo.ts';
import {applyAction} from '/src/domain/game.ts';
import * as history from '/src/domain/history.ts';
import {cardNames,normaliseCardName} from '/src/domain/cardNames.ts';
import {localRepository} from '/src/services/storage.ts';
import {getStarterDecks} from '/src/services/starters.ts';
import {PeerRoom} from '/src/services/peerRoom.ts';
import {PeerTransport} from '/src/services/peerTransport.ts';
const base=startDemoMatch('Benchmark',preconFixtureDecks().slice(0,4));
const sample=addStressObjects(base,200);
if(location.search.includes('images')) {
 const definitions=preconCards.filter(c=>c.image_uris?.small);
 Object.values(sample.cards).filter(c=>c.id.includes('-stress-')).forEach((c,i)=>{
   c.card=definitions[i%definitions.length];c.cardId=c.card.id;
 });
}
const state=ref(sample);
window.benchmark={state,toRaw,nextTick,applyAction,history,preconCards,cardNames,normaliseCardName,localRepository,getStarterDecks,PeerRoom,PeerTransport};
if(!location.search.includes('services')){
 const app=createApp({setup:()=>()=>[h(GameTable,{state:state.value,seatId:'southWest',playmatIds:{northWest:'azorius',southWest:'boros'},online:false}),h(CardInspection)]});
 app.mixin({updated(){const name=this.$options.__name;if(name==='GameTable')window.measurements.renders++;if(name==='TableField')window.measurements.fieldRenders++;}});
 app.mount('#app');
}
window.benchmarkReady=true;
`;
const reuse = process.argv.includes('--reuse-build');
const result = reuse ? { output: (await readdir(path.join(destination, 'build/assets'))).map(name => ({
  fileName: 'assets/' + name, type: name.endsWith('.js') ? 'chunk' : 'asset',
  isEntry: name.startsWith('_virtual_performance-benchmark') && name.endsWith('.js'),
})) } : await build({
  root, logLevel: 'error',
  plugins: [{
    name: 'performance-measurements', enforce: 'pre',
    resolveId(id) { if (id === entry) return '\0' + entry; },
    load(id) { if (id === '\0' + entry) return source; },
    transform(code, id) {
      if (id.endsWith('/src/components/GameTable.vue')) {
        return code.replace(/return Object.values\(props.state.cards\)\.filter\(card => card\.(controllerId|ownerId) === seat.id && card.zone === zone\);/g, 'window.measurements.scans++; $&');
      }
      if (id.endsWith('/src/domain/tableCards.ts')) return code.replace('  const seats = new Map', '  globalThis.__performanceMeasurements && globalThis.__performanceMeasurements.indexBuilds++;\n  const seats = new Map');
      if (id.endsWith('/src/services/roomProtocol.ts')) return code.replace(/(export function splitRoomPacket[^{]+\{)/, '$1 globalThis.__performanceMeasurements && globalThis.__performanceMeasurements.encodes++;');
    },
  }],
  build: { outDir: path.join(destination, 'build'), emptyOutDir: true, rollupOptions: { input: entry } },
});
const output = result.output;
const js = output.find(item => item.type === 'chunk' && item.isEntry).fileName;
const css = output.filter(item => item.fileName.endsWith('.css')).map(item => item.fileName);
const html = '<!doctype html><html><head>' + css.map(file => '<link rel="stylesheet" href="/' + file + '">').join('') +
  '</head><body><div id="app"></div><script type="module" src="/' + js + '"></script></body></html>';
const server = createServer(async (req, res) => {
  if (req.url.startsWith('/benchmark')) { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
  const filename = path.resolve(destination, 'build', '.' + new URL(req.url, 'http://local').pathname);
  if (!filename.startsWith(path.join(destination, 'build') + path.sep)) { res.writeHead(403).end(); return; }
  try {
    res.setHeader('Content-Type', filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : filename.endsWith('.webp') ? 'image/webp' : 'image/svg+xml');
    res.end(await readFile(filename));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseURL = 'http://127.0.0.1:' + server.address().port;
// A distinct origin gives the image scene a genuinely empty cache, independent of the token scene.
const imageServer = createServer(server.listeners('request')[0]);
await new Promise(resolve => imageServer.listen(0, '127.0.0.1', resolve));
const imageURL = 'http://127.0.0.1:' + imageServer.address().port;
let browser;
const samples = [];
try {
  browser = await chromium.launch({ headless: true, args: ['--enable-precise-memory-info'] });
  const system = await (await browser.newBrowserCDPSession()).send('SystemInfo.getInfo');
  const environment = { node: process.version, browser: browser.version(), cpu: os.cpus()[0].model, memoryGiB: os.totalmem() / 2 ** 30,
    platform: os.platform(), release: os.release(), arch: os.arch(), measuredAt: new Date().toISOString(),
    buildHash: createHash('sha256').update(await readFile(path.join(destination, 'build', js))).digest('hex'),
    renderer: system.gpu.auxAttributes.glRenderer, viewport: { width: 1280, height: 720 }, production: true, externalFonts: false };
  for (let sample = -1; sample < 3; sample++) {
    const context = await browser.newContext({ viewport: environment.viewport });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
    await page.route('https://fonts.gstatic.com/**', route => route.abort());
    await page.addInitScript(() => {
      let seed = 12345;
      Date.now = () => 1_800_000_000_000;
      Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
      crypto.getRandomValues = array => { for (let i = 0; i < array.length; i++) array[i] = Math.floor(Math.random() * 2 ** 32); return array; };
      let sequence = 0;
      crypto.randomUUID = () => '00000000-0000-4000-8000-' + String(++sequence).padStart(12, '0');
      window.measurements = { scans: 0, indexBuilds: 0, renders: 0, fieldRenders: 0, encodes: 0, longTasks: [] };
      window.__performanceMeasurements = window.measurements;
      new PerformanceObserver(list => window.measurements.longTasks.push(...list.getEntries().map(e => e.duration))).observe({ type: 'longtask', buffered: true });
    });
    const images = await page.evaluate(() => Object.fromEntries([['small',146],['normal',488],['large',672]].map(([size,width]) => {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = Math.round(width * 204 / 146);
      const ctx = canvas.getContext('2d'); let seed = 42;
      for (let y = 0; y < canvas.height; y += 4) for (let x = 0; x < width; x += 4) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        ctx.fillStyle = 'rgb(' + (seed & 255) + ',' + ((seed >> 8) & 255) + ',' + ((seed >> 16) & 255) + ')'; ctx.fillRect(x,y,4,4);
      }
      return [size,canvas.toDataURL('image/jpeg',.65).split(',')[1]];
    })));
    let requests = 0, imageBytes = 0;
    await page.route('https://cards.scryfall.io/**', route => {
      const size = new URL(route.request().url()).pathname.split('/')[1];
      const body = Buffer.from(images[size] ?? images.small,'base64'); requests++; imageBytes += body.length;
      return route.fulfill({ contentType:'image/jpeg',body });
    });
    const cdp = await context.newCDPSession(page);
    const record = { sample, scenes: [] };
    for (const imagesEnabled of [false,true]) {
      for (const warm of [false,true]) {
        requests = 0; imageBytes = 0;
        if (warm) await page.reload(); else await page.goto((imagesEnabled ? imageURL : baseURL) + '/benchmark' + (imagesEnabled ? '?images' : ''));
        await page.waitForFunction(() => window.benchmarkReady);
        await page.waitForTimeout(1200);
        const metrics = await page.evaluate(async () => {
          const m=window.measurements; m.scans=0;m.indexBuilds=0;m.renders=0;m.fieldRenders=0;m.longTasks=[];
          const stage=document.querySelector('.table-stage'),rect=stage.getBoundingClientRect();const times=[];let last=performance.now();
          for(let i=0;i<16;i++){
            await new Promise(requestAnimationFrame); const now=performance.now();times.push(now-last);last=now;
            stage.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'mouse',clientX:rect.left+rect.width*(.35+.18*Math.sin(i*.3)),clientY:rect.top+rect.height*.4}));
          }
          await new Promise(resolve=>setTimeout(resolve,400));
          times.sort((a,b)=>a-b);
          return {...m,longTasks:m.longTasks.length,longTaskMs:m.longTasks.reduce((n,v)=>n+v,0),frameP50:(times[7]+times[8])/2,frameP95:times[15]};
        });
        await cdp.send('HeapProfiler.collectGarbage');
        metrics.heapMiB = (await cdp.send('Runtime.getHeapUsage')).usedSize / 2 ** 20;
        record.scenes.push({ images:imagesEnabled,warm,requests,imageBytes,...metrics });
        if (sample === 0 && imagesEnabled && warm) await page.screenshot({ path:path.join(destination,'table.png') });
        await page.locator('.table-stage').evaluate(stage=>stage.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-100})));
        const card=page.locator('.board-card-wrap').last();
        await card.click({ button:'middle',force:true }); await page.keyboard.press('Escape');
        const box=await card.boundingBox();
        if(box){await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+20,box.y+20,{steps:3});await page.mouse.up();}
      }
    }
    await page.goto(baseURL + '/benchmark?services'); await page.waitForFunction(() => window.benchmarkReady);
    await cdp.send('HeapProfiler.collectGarbage');
    const initialHeap=(await cdp.send('Runtime.getHeapUsage')).usedSize;
    record.history=await page.evaluate(()=>{
      const b=window.benchmark;let state=b.toRaw(b.state.value);const manager=b.history.MatchHistory?new b.history.MatchHistory():undefined;
      const retained=[];const started=performance.now();
      for(let i=0;i<200;i++){
        const before=manager?state:structuredClone(state);
        state=b.applyAction(before,'southWest',{type:'SET_LIFE',amount:i%2?1:-1});
        if(manager)manager.record(before,state);else retained.push({before,after:structuredClone(state)});
      }
      window.retainedHistory=manager??retained;
      window.retainedHistoryState=state;
      return{actions:200,entries:manager?manager.size:retained.length,elapsedMs:performance.now()-started};
    });
    await cdp.send('HeapProfiler.collectGarbage');
    record.history.retainedMiB=((await cdp.send('Runtime.getHeapUsage')).usedSize-initialHeap)/2**20;
    if (await page.evaluate(() => Boolean(window.benchmark.history.MatchHistory))) {
      await page.evaluate(() => {
        const b=window.benchmark; let state=window.retainedHistoryState;
        for(let i=200;i<1000;i++) { const next=b.applyAction(state,'southWest',{type:'SET_LIFE',amount:i%2?1:-1}); window.retainedHistory.record(state,next);state=next; }
        window.retainedHistoryState=state;
      });
      await cdp.send('HeapProfiler.collectGarbage');
      record.history.retainedAfter1000MiB=((await cdp.send('Runtime.getHeapUsage')).usedSize-initialHeap)/2**20;
    }
    record.network=await page.evaluate(async()=>{
      const b=window.benchmark,room=new b.PeerRoom(),transport=new b.PeerTransport('audit','self','self',1,{send:async()=>{},subscribe:()=>()=>{}},async()=>[]);
      const received={a:0,b:0,c:0};let bytes=0;
      for(const uid of Object.keys(received))transport.peers.set(uid,{sequence:0,reliable:{readyState:'open',bufferedAmount:0,send:p=>{received[uid]++;bytes+=new TextEncoder().encode(p).length;}}});
      const state=b.toRaw(b.state.value);
      const visible=Object.values(state.cards).filter(c=>!['hand','library'].includes(c.zone)||c.revealed);
      room.isHost=()=>true;room.publicState={...state,
        seats:state.seats.map(({hand,library,...seat})=>seat),
        cards:Object.fromEntries(visible.map(c=>[c.id,c.faceDown?{...c,card:undefined,cardId:'face-down'}:c])),
        log:state.log.filter(e=>e.public),
        hiddenZones:Object.fromEntries(state.seats.map(s=>[s.id,{hand:s.hand.length,library:s.library.length,graveyard:visible.filter(c=>c.ownerId===s.id&&c.zone==='graveyard').length,exile:visible.filter(c=>c.ownerId===s.id&&c.zone==='exile').length}]))};room.members=Object.keys(received).map(uid=>({uid}));room.transport=transport;
      window.measurements.encodes=0;
      if(room.sendCheckpointToPeer)await room.sendCheckpointToPeer('a');else await room.sendCheckpointToNewPeers();
      return{packets:received,bytes,encodes:window.measurements.encodes};
    });
    await page.route('https://api.scryfall.com/**',async route=>{
      const identifiers=route.request().postDataJSON().identifiers;
      const data=await page.evaluate(ids=>{const b=window.benchmark;return ids.map(id=>b.preconCards.find(c=>id.id?c.id===id.id:b.cardNames(c).includes(b.normaliseCardName(id.name)))).filter(Boolean);},identifiers);
      await route.fulfill({json:{data,not_found:[],has_more:false}});
    });
    record.library=await page.evaluate(async()=>{
      const b=window.benchmark,repo=b.localRepository;let reads=0;const original=repo.getDecks.bind(repo);
      repo.getDecks=()=>{reads++;return original();};
      const t=performance.now();const cold=await b.getStarterDecks();const coldReads=reads,coldMs=performance.now()-t;reads=0;
      const s=performance.now();const warm=await b.getStarterDecks();
      if(cold.decks.length!==30||warm.decks.length!==30)throw Error('Incomplete benchmark library');
      return{coldReads,coldMs,warmReads:reads,warmMs:performance.now()-s};
    });
    if(errors.length)throw new Error(errors.join('\n'));
    if(sample>=0)samples.push(record);
    console.log((sample<0?'Warmup':'Sample '+(sample+1))+' complete');
    await context.close();
  }
  const median = values => [...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
  const summary={label,environment,configuration:{seed:12345,clock:1_800_000_000_000,permanents:200,cameraMoves:16,warmups:1,samples:3},samples,medians:{
    historyRetainedMiB:median(samples.map(s=>s.history.retainedMiB)),
    historyEntries:median(samples.map(s=>s.history.entries)),
    historyElapsedMs:median(samples.map(s=>s.history.elapsedMs)),
    ...(samples[0].history.retainedAfter1000MiB === undefined ? {} : {
      historyRetainedAfter1000MiB:median(samples.map(s=>s.history.retainedAfter1000MiB)),
    }),
    libraryColdReads:median(samples.map(s=>s.library.coldReads)),
    libraryColdMs:median(samples.map(s=>s.library.coldMs)),
    checkpointBytes:median(samples.map(s=>s.network.bytes)),
    checkpointPackets:median(samples.map(s=>Object.values(s.network.packets).reduce((sum,n)=>sum+n,0))),
    checkpointEncodes:median(samples.map(s=>s.network.encodes)),
    scenes:samples[0].scenes.map((scene,i)=>Object.fromEntries(Object.keys(scene).map(key=>[key,typeof scene[key]==='number'?median(samples.map(s=>s.scenes[i][key])):scene[key]]))),
  }};
  await writeFile(path.join(destination,'summary.json'),JSON.stringify(summary,null,2));
  console.log(JSON.stringify({label,environment,medians:summary.medians},null,2));
} finally {
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
  await new Promise(resolve=>imageServer.close(resolve));
}
