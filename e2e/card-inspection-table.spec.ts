import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { preconFixtureDecks } from '../tests/fixtures/precons';
import { revealHand } from './navigation';

async function tableHarness(page:Page) {
 await page.emulateMedia({reducedMotion:'reduce'});
 const component=await(await page.request.get('/src/components/CardTile.vue')).text();
 const runtime=component.match(/from ["']([^"']*\/vue\.js[^"']*)["']/)![1];
 await page.route('**/inspection-table-harness',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><link rel="stylesheet" href="/src/style.css"></head><body><div id="app"></div><script type="module">
 import {createApp,h,ref,toRaw} from '${runtime}';
 import GameTable from '/src/components/GameTable.vue';
 import CardInspection from '/src/components/CardInspection.vue';
 import {startDemoMatch} from '/src/services/demo.ts';
 import {applyAction} from '/src/domain/game.ts';
 import {initializeLocale} from '/src/i18n/index.ts';
 import {localRepository} from '/src/services/storage.ts';
 initializeLocale('pt-BR', ['pt-BR']);
 await localRepository.setPreference('hide-table-tutorial', true);
 const decks=${JSON.stringify(preconFixtureDecks())};
 const state=ref(startDemoMatch('Lia',decks,decks[0]));
 createApp({setup:()=>()=>h('div',{},[h(GameTable,{state:state.value,seatId:'southWest',online:false,playmatIds:{},onActions:actions=>{for(const action of actions)state.value=applyAction(toRaw(state.value),'southWest',action);}}),h(CardInspection)])}).mount('#app');
 </script></body></html>`}));
 await page.goto('/inspection-table-harness');
 await expect(page.locator('.player-mat')).toHaveCount(4);
}

test('keeps draw, selection, double click, drag and menu actions working with shared inspection',async({page})=>{
 await tableHarness(page);
 await page.keyboard.press('Control+d');
 await expect(page.locator('.own-hand-fan .fan-card')).toHaveCount(8);
 await expect(page.locator('.shared-card-inspection')).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(page.locator('.shared-card-inspection')).toHaveCount(0);
 const card=page.locator('.mat-southWest .board-card-wrap').first();
 await card.click();
 await expect(card).toHaveClass(/is-picked/);
 const tapped=await card.locator('.card-pose').evaluate(el=>el.classList.contains('is-tapped'));
 await card.dblclick();
 await expect(card.locator('.card-pose')).toHaveClass(tapped?/^card-pose motion-reduced$/:/is-tapped/);
 const before=await card.getAttribute('style');
 const box=await card.boundingBox();
 await page.mouse.move(box!.x+box!.width/2,box!.y+box!.height/2);
 await page.mouse.down();
 await page.mouse.move(box!.x+box!.width/2+45,box!.y+box!.height/2-25,{steps:8});
 await page.mouse.up();
 await expect.poll(()=>card.getAttribute('style')).not.toBe(before);
 await card.hover();
 await page.keyboard.press('z');
 await expect(page.locator('.shared-card-inspection')).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(page.locator('.shared-card-inspection')).toHaveCount(0);
 await card.click({button:'right'});
 await expect(page.getByRole('menu')).toBeVisible();
 await expect(page.locator('.shared-card-inspection')).toHaveCount(0);
 await page.getByRole('menuitem',{name:'Mover ao cemitério',exact:true}).click();
 const pile=page.getByRole('button',{name:/^Cemitério de Lia/});
 await pile.click();
 const zone=page.locator('.table-stage .fan-graveyard');
 const zoneCard=zone.locator('.public-zone-fan-card');
 await zoneCard.click();
 await expect(page.getByRole('dialog',{name:/Inspecionar/})).toBeVisible();
 await expect(page.locator('.shared-card-inspection')).toHaveCSS('z-index','10000');
 await page.getByRole('button',{name:'Fechar inspeção',exact:true}).click();
 await expect(zone).toBeVisible();
 await expect(zoneCard).toBeFocused({timeout:1000});
});

test('enables inspection for commanders, stack, hand and cards inside the public zone viewer',async({page})=>{
 await tableHarness(page);
 for(const selector of ['.seat-place[data-seat=southWest] .commander-zone .card-tile','.stack-back .card-tile','.fan-card:last-child .card-tile']){
   if(selector.startsWith('.fan-card')) await revealHand(page);
   const tile=page.locator(selector).first();
   await tile.hover();
   await page.keyboard.press('z');
   await expect(page.locator('.shared-card-inspection')).toBeVisible();
   await expect(tile).toHaveClass(/inspection-source-hidden/);
   await page.keyboard.press('Escape');
   await expect(page.locator('.shared-card-inspection')).toHaveCount(0);
   await page.mouse.move(10,10);
 }
 const card=page.locator('.mat-southWest .board-card-wrap').first();
 await card.click({button:'right'});
 await page.getByRole('menuitem',{name:'Mover ao cemitério',exact:true}).click();
 await page.getByRole('button',{name:/^Cemitério de Lia/}).click();
 const tile=page.locator('.table-stage .public-zone-fan-card .card-tile').first();
 await tile.hover();
 await page.keyboard.press('z');
 await expect(page.locator('.shared-card-inspection')).toBeVisible();
 await expect(tile).toHaveClass(/inspection-source-hidden/);
 await expect(page.locator('.shared-card-inspection')).toHaveAttribute('data-phase','details');
});
