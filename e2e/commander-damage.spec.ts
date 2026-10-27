import { expect, test } from './fixtures';
import { preconFixtureDecks } from '../tests/fixtures/precons';

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`adjusts received commander damage beside the actions at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await (await page.request.get('/src/components/CardTile.vue')).text();
    const runtime = component.match(/from ["']([^"']*\/vue\.js[^"']*)["']/)![1];
    await page.route('**/commander-damage-harness', route => route.fulfill({ contentType: 'text/html', body: `
      <!doctype html><html><head><link rel="stylesheet" href="/src/style.css"></head><body><div id="app"></div><script type="module">
      import {createApp,h,ref,toRaw} from '${runtime}';
      import GameTable from '/src/components/GameTable.vue';
      import {initializeLocale} from '/src/i18n/index.ts';
      import {localRepository} from '/src/services/storage.ts';
      initializeLocale('pt-BR', ['pt-BR']);
      await localRepository.setPreference('hide-table-tutorial', true);
      import {startDemoMatch} from '/src/services/demo.ts';
      import {applyAction,commandersForSeat} from '/src/domain/game.ts';
      const decks=${JSON.stringify(preconFixtureDecks())};
      const initial=startDemoMatch('Lia',decks,decks[0]);
      const opponent=initial.seats.find(seat=>seat.id==='northWest');
      const commander=commandersForSeat(initial,opponent.id)[0];
      const partner=structuredClone(initial.cards[commander.id]);
      partner.id='partner-instance'; partner.cardId='partner-definition';
      partner.card={...partner.card,id:partner.cardId,name:'Partner Commander'};
      initial.cards[partner.id]=partner; opponent.commanderIds.push(partner.cardId);
      const state=ref(initial);
      const busy=ref(false);
      window.commanderHarness={state,busy};
      createApp({setup:()=>()=>h(GameTable,{state:state.value,busy:busy.value,seatId:'southWest',online:false,playmatIds:{},onActions:actions=>{
        for(const action of actions)state.value=applyAction(toRaw(state.value),'southWest',action);
      }})}).mount('#app');
      </script></body></html>` }));
    await page.goto('/commander-damage-harness');
    const note = page.getByRole('region', { name: 'Dano de comandante', exact: true });
    const rows = note.locator('.commander-damage-row');
    await expect(rows).toHaveCount(4);
    await expect(note.locator('.commander-damage-group')).toHaveCount(3);
    for (const row of await rows.all()) {
      await expect(row.locator('output')).toHaveText('0');
      await expect(row.getByRole('button', { name: /Diminuir/ })).toBeDisabled();
    }
    await page.screenshot({ path: `test-results-commander-damage/before-${viewport.width}.png` });
    const partner = note.locator('[data-commander-id="partner-instance"]');
    await expect(partner).toContainText('Partner Commander');
    const noteBounds = await note.boundingBox();
    expect(noteBounds!.x).toBeGreaterThanOrEqual(0);
    expect(noteBounds!.x + noteBounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(noteBounds!.y + noteBounds!.height).toBeLessThanOrEqual(viewport.height);
    const life = await page.locator('.seat-life-value').allTextContents();
    expect(life).toHaveLength(4);
    await partner.getByRole('button', { name: /Aumentar/ }).click();
    await expect(partner.locator('output')).toHaveText('1');
    await page.evaluate(() => {
      const { state } = (window as any).commanderHarness;
      state.value.seats.find((seat: any) => seat.id === 'southWest').commanderDamage['partner-definition'] = 20;
    });
    await expect(partner).not.toHaveClass(/is-lethal/);
    await partner.getByRole('button', { name: /Aumentar/ }).click();
    await expect(partner.locator('output')).toHaveText('21');
    await expect(partner).toHaveClass(/is-lethal/);
    await expect(partner).toHaveCSS('color', 'rgb(161, 36, 36)');
    await expect(rows.first()).not.toHaveClass(/is-lethal/);
    await partner.getByRole('button', { name: /Aumentar/ }).click();
    await expect(partner.locator('output')).toHaveText('22');
    await expect(partner).toHaveClass(/is-lethal/);
    await partner.getByRole('button', { name: /Diminuir/ }).click();
    await partner.getByRole('button', { name: /Diminuir/ }).click();
    await expect(partner.locator('output')).toHaveText('20');
    await expect(partner).not.toHaveClass(/is-lethal/);
    await page.evaluate(() => {
      const { state } = (window as any).commanderHarness;
      state.value.seats.find((seat: any) => seat.id === 'southWest').commanderDamage['partner-definition'] = 1;
    });
    await expect(rows.first().locator('output')).toHaveText('0');
    await partner.getByRole('button', { name: /Diminuir/ }).click();
    await expect(partner.locator('output')).toHaveText('0');
    await expect(partner.getByRole('button', { name: /Diminuir/ })).toBeDisabled();
    expect(await page.locator('.seat-life-value').allTextContents()).toEqual(life);
    await page.evaluate(() => {
      const { state } = (window as any).commanderHarness;
      state.value.cards['partner-instance'].zone = 'graveyard';
      state.value.cards['partner-instance'].controllerId = 'southWest';
      state.value.seats.find((seat: any) => seat.id === 'northWest').status = 'eliminated';
    });
    await expect(partner).toBeVisible();
    await partner.getByRole('button', { name: /Aumentar/ }).click();
    await expect(partner.locator('output')).toHaveText('1');
    await page.screenshot({ path: `test-results-commander-damage/commander-damage-${viewport.width}.png` });
    for (const mode of ['busy', 'paused', 'finished']) {
      await page.evaluate(mode => {
        const { state, busy } = (window as any).commanderHarness;
        busy.value = mode === 'busy';
        state.value.paused = mode === 'paused';
        state.value.phase = mode === 'finished' ? 'finished' : 'playing';
      }, mode);
      await expect(partner.getByRole('button', { name: /Aumentar/ })).toBeDisabled();
      await expect(partner.getByRole('button', { name: /Diminuir/ })).toBeDisabled();
    }
  });
}
