import { test, expect } from './fixtures';

test('camera and cursor movement leave the card fields unchanged', async ({ page }) => {
  const source = await (await page.request.get('/src/components/GameTable.vue')).text();
  const runtime = source.match(/from ["']([^"']*\/vue\.js[^"']*)["']/)![1];
  await page.route('**/performance-fixture', route => route.fulfill({ contentType: 'text/html', body:
    '<!doctype html><html><head><link rel="stylesheet" href="/src/style.css"></head><body><div id="app"></div><script type="module">' +
    'import {createApp,h,ref,nextTick} from "' + runtime + '";' +
    'import GameTable from "/src/components/GameTable.vue";' +
    'import {localRepository} from "/src/services/storage.ts";await localRepository.setPreference("hide-table-tutorial",true);' +
    'import AppCursor from "/src/components/AppCursor.vue";' +
    'import {startDemoMatch,addStressObjects} from "/src/services/demo.ts";' +
    'import {fixtureDecks} from "/tests/fixtures/scryfall.ts";' +
    'window.fields=0;const state=ref(addStressObjects(startDemoMatch("Lia",fixtureDecks()),200));' +
    'const app=createApp({setup:()=>()=>h("div",[h(GameTable,{state:state.value,seatId:"southWest",playmatIds:{},online:false}),h(AppCursor,{playerName:"Lia"})])});' +
    'app.mixin({updated(){if(this.$options.__name==="TableField")window.fields++}});app.mount("#app");' +
    'window.fixture={state,nextTick};</script></body></html>' }));
  await page.goto('/performance-fixture');
  await expect(page.locator('.board-card-wrap[data-card-id*="-stress-"]')).toHaveCount(200);
  await page.waitForTimeout(300);
  await page.evaluate(async () => {
    (window as any).fields = 0;
    const stage = document.querySelector('.table-stage')!;
    const rect = stage.getBoundingClientRect();
    for (let i = 0; i < 40; i++) {
      stage.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', clientX: rect.left + rect.width * (.4 + Math.sin(i) * .1), clientY: rect.top + rect.height * .4 }));
      await new Promise(requestAnimationFrame);
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  });
  expect(await page.evaluate(() => (window as any).fields)).toBe(0);
  await expect(page.locator('.table-stage')).not.toHaveAttribute('data-lean', '0');
  await expect(page.locator('.app-global-cursor')).toBeAttached();
});
