import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function harness(page: Page) {
  const component = await (await page.request.get('/src/components/CardTile.vue')).text();
  const controller = component.match(/from ["']([^"']*\/services\/cardInspection\.ts[^"']*)["']/)![1];
  const runtime = component.match(/from ["']([^"']*\/vue\.js[^"']*)["']/)![1];
  await page.route('**/inspection-harness', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><link rel="stylesheet" href="/src/style.css"></head><body><div id="app"></div><script type="module">
    import { createApp, h, ref } from '${runtime}';
    import CardTile from '/src/components/CardTile.vue';
    import CardInspection from '/src/components/CardInspection.vue';
    import { cardInspection, openCardInspection, closeCardInspection } from '${controller}';
    const visible = ref(true), hidden = ref(false);
    const definition = { id:'front',name:'Front // Back',layout:'transform',mana_cost:'{G}',type_line:'Creature',oracle_text:'Test rules',card_faces:[{name:'Front',mana_cost:'{G}',type_line:'Creature',oracle_text:'Front rules',power:'1',toughness:'3'},{name:'Back',mana_cost:'',type_line:'Creature',oracle_text:'Back rules'}] };
    const card = () => ({id:'one',card:definition,faceDown:hidden.value,face:0,counters:{'+1/+1':3}});
    const { initializeLocale } = await import('/src/i18n/index.ts');
    initializeLocale('pt-BR', ['pt-BR']);
    createApp({setup:()=>()=>h('div',{},[
      visible.value && h('button',{id:'one',style:{position:'fixed',left:'60px',top:'110px',width:'110px',height:'154px',padding:0,transform:'perspective(700px) rotateX(30deg) rotateZ(-15deg)'},onClick:event=>openCardInspection({element:event.currentTarget.querySelector('.card-tile'),opener:event.currentTarget,read:()=>({card:card(),quantity:3})})},[h(CardTile,{card:card(),quantity:3})]),
      h('button',{id:'two',style:{position:'fixed',left:'calc(100% - 150px)',top:'110px',width:'110px',height:'154px',padding:0}},[h(CardTile,{definition:{...definition,id:'two',name:'Second',card_faces:undefined}})]),
      h('div',{id:'decorative',style:{position:'fixed',left:'60px',top:'350px',width:'60px',height:'84px'}},[h(CardTile,{definition,zoomEnabled:false})]),
      h(CardInspection)
    ])}).mount('#app');
    window.fixture = {visible,hidden,cardInspection,close:closeCardInspection};
  </script></body></html>` }));
  await page.goto('/inspection-harness');
  await expect(page.locator('#one .card-tile')).toBeVisible();
}

test('keeps hover passive, opens with Z and animates for 400ms before details', async ({ page }) => {
  await harness(page);
  await page.clock.install({time:new Date('2026-10-15T12:00:00Z')});
  await page.clock.pauseAt('2026-10-15T12:00:01Z');
  await page.locator('#one').hover();
  await page.clock.runFor(1000);
  await expect(page.locator('.shared-card-inspection')).toHaveCount(0);
  await page.keyboard.press('z');
  await expect(page.locator('.shared-card-inspection')).toHaveAttribute('data-phase','opening');
  await expect(page.locator('#one .card-tile')).toHaveClass(/inspection-source-hidden/);
  const error = await page.locator('.shared-inspection-art').evaluate(art => {
    const frames = (art.getAnimations()[0].effect as KeyframeEffect).getKeyframes();
    const matrix = new DOMMatrix(frames[0].transform as string);
    const width = (art as HTMLElement).offsetWidth, height = (art as HTMLElement).offsetHeight;
    const corners = [...document.querySelectorAll('#one [data-inspection-corner]')];
    return Math.max(...[[0,0],[width,0],[width,height],[0,height]].map(([x,y],index) => {
      const point = matrix.transformPoint(new DOMPoint(x,y));
      const corner = corners[index].getBoundingClientRect();
      return Math.hypot(point.x / point.w - corner.left, point.y / point.w - corner.top);
    }));
  });
  expect(error).toBeLessThan(2);
  await page.clock.runFor(400);
  await expect(page.locator('.shared-card-inspection')).toHaveAttribute('data-phase','details');
  await expect(page.locator('.shared-inspection-copy')).toContainText('QUANTIDADE NO DECK · 3');
});

test('tracks the hovered card for explicit inspection and keeps it pinned during travel', async ({ page }) => {
  await harness(page);
  await page.clock.install({time:new Date('2026-10-15T12:00:00Z')});
  await page.clock.pauseAt('2026-10-15T12:00:01Z');
  await page.locator('#one').hover();
  await page.clock.runFor(800);
  await page.mouse.move(10,10);
  await page.clock.runFor(1000);
  await expect(page.locator('.shared-card-inspection')).toHaveCount(0);
  await page.locator('#one').hover();
  await page.clock.runFor(1100);
  await page.locator('#two').hover();
  await page.keyboard.press('z');
  await expect(page.locator('#one .card-tile')).not.toHaveClass(/inspection-source-hidden/);
  await page.clock.runFor(1000);
  await expect(page.locator('.shared-inspection-art .card-tile')).toContainText('Second');
  await page.mouse.move(10,10);
  await page.clock.runFor(500);
  await page.clock.runFor(1000);
  await expect(page.locator('.shared-card-inspection')).toHaveAttribute('data-phase','details');
  await page.mouse.move(10,10);
  await page.clock.runFor(1000);
  await expect(page.locator('.shared-card-inspection')).toHaveAttribute('data-phase','details');
  await page.keyboard.press('z');
  await expect(page.locator('.shared-card-inspection')).toHaveAttribute('data-phase','closing');
  await page.clock.runFor(250);
  await expect(page.locator('.shared-card-inspection')).toHaveCount(0);
  await expect(page.locator('#two .card-tile')).not.toHaveClass(/inspection-source-hidden/);
});

test('explicit inspection pins, supports faces and restores keyboard focus', async ({ page }) => {
  await harness(page);
  await page.locator('#one').click();
  await expect(page.getByRole('dialog')).toBeFocused();
  await expect(page.locator('.shared-inspection-copy')).toBeVisible();
  await expect(page.locator('.shared-inspection-art .shared-inspection-counter')).toHaveCount(0);
  await expect(page.locator('.shared-inspection-stats + .shared-inspection-counters')).toHaveText('+3/+3');
  await page.screenshot({path:test.info().outputPath('inspection-wide.png')});
  await page.getByRole('button',{name:'Back',exact:true}).click();
  await expect(page.locator('.shared-inspection-copy h2')).toHaveText('Back');
  await page.mouse.move(10,10);
  await page.waitForTimeout(700);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.shared-card-inspection')).toHaveCount(0);
  await expect(page.locator('#one')).toBeFocused();
});

test('blocks private and decorative cards, cancels pointer actions and handles removal', async ({ page }) => {
  await harness(page);
  await page.evaluate(() => { (window as any).fixture.hidden.value = true; });
  await page.locator('#one').hover();
  await page.waitForTimeout(1100);
  await expect(page.locator('.shared-card-inspection')).toHaveCount(0);
  await page.locator('#decorative').hover();
  await page.waitForTimeout(1100);
  await expect(page.locator('.shared-card-inspection')).toHaveCount(0);
  await page.locator('#two').hover();
  await page.mouse.down();
  await page.waitForTimeout(1100);
  await expect(page.locator('.shared-card-inspection')).toHaveCount(0);
  await page.mouse.up();
  await page.evaluate(() => { (window as any).fixture.hidden.value = false; });
  await page.locator('#one').hover();
  await page.keyboard.press('z');
  await expect(page.locator('.shared-card-inspection')).toBeVisible();
  await page.evaluate(() => { (window as any).fixture.visible.value = false; });
  await expect(page.locator('.shared-card-inspection')).toHaveCount(0);
});

test('fits narrow windows and keeps timing with reduced motion', async ({ page }) => {
  await page.setViewportSize({width:390,height:740});
  await page.emulateMedia({reducedMotion:'reduce'});
  await harness(page);
  await page.clock.install({time:new Date('2026-10-15T12:00:00Z')});
  await page.clock.pauseAt('2026-10-15T12:00:01Z');
  await page.locator('#one').hover();
  await page.clock.runFor(1000);
  await expect(page.locator('.shared-card-inspection')).toHaveCount(0);
  await page.keyboard.press('z');
  await expect(page.locator('.shared-card-inspection')).toHaveAttribute('data-phase','opening');
  await page.clock.runFor(400);
  await page.clock.runFor(1000);
  await expect(page.locator('.shared-card-inspection')).toHaveAttribute('data-phase','details');
  const box = await page.locator('.shared-inspection-art').boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await expect(page.locator('.shared-inspection-copy')).toBeVisible();
  await expect(page.locator('.shared-inspection-copy .shared-inspection-counter')).toHaveText('+3/+3');
  const copy = await page.locator('.shared-inspection-copy').boundingBox();
  expect(copy!.y + copy!.height).toBeLessThanOrEqual(740);
  await page.screenshot({path:test.info().outputPath('inspection-narrow.png')});
});
