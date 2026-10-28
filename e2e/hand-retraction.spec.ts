import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { revealHand } from './navigation';
import { preconFixtureDecks } from '../tests/fixtures/precons';

async function harness(page: Page, reducedMotion = true): Promise<void> {
  await page.emulateMedia({ reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
  const component = await (await page.request.get('/src/components/CardTile.vue')).text();
  const runtime = component.match(/from ["']([^"']*\/vue\.js[^"']*)["']/)![1];
  await page.route('**/hand-harness', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><link rel="stylesheet" href="/src/style.css"></head><body><div id="app"></div><script type="module">
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
    const seatId=ref('southWest');
    window.handFixture={state,seatId};
    createApp({setup:()=>()=>h('div',{},[
      h(GameTable,{state:state.value,seatId:seatId.value,online:false,playmatIds:{},onActions:actions=>{for(const action of actions)state.value=applyAction(toRaw(state.value),seatId.value,action);}}),h(CardInspection)
    ])}).mount('#app');
  </script></body></html>` }));
  await page.goto('/hand-harness');
  await expect(page.locator('.own-hand-fan .fan-card')).toHaveCount(7);
}

async function peekHeight(page: Page): Promise<number> {
  return page.locator('.own-hand-fan').evaluate(fan => {
    const top = Math.min(...[...fan.querySelectorAll('.fan-card')].map(card => card.getBoundingClientRect().top));
    return fan.getBoundingClientRect().bottom - top;
  });
}

test('leaves a 28px peek, expands across gaps and exposes the playmat when collapsed', async ({ page }, testInfo) => {
  await harness(page);
  const hand = page.locator('.own-hand-fan');
  await expect(hand).not.toHaveClass(/is-expanded/);
  await expect.poll(() => peekHeight(page)).toBeGreaterThanOrEqual(27);
  expect(await peekHeight(page)).toBeLessThanOrEqual(28);
  await page.screenshot({ path: testInfo.outputPath('hand-collapsed.png') });
  await revealHand(page);
  const bounds = (await hand.boundingBox())!;
  // Empty space above the cards remains in the stable expanded area.
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 4);
  await expect(hand).toHaveClass(/is-expanded/);
  await page.screenshot({ path: testInfo.outputPath('hand-expanded.png') });
  await page.mouse.move(5, 5);
  await expect(hand).not.toHaveClass(/is-expanded/);
  expect(await hand.evaluate(fan => {
    const bounds = fan.getBoundingClientRect();
    return Boolean(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.bottom - 70)?.closest('.own-hand-fan'));
  })).toBe(false);
  await expect(hand.locator('.own-hand-cards')).toHaveCSS('transition-duration', '0s');
});

test('follows drag coordinates despite pointer capture and returns a battlefield card to hand', async ({ page }) => {
  await harness(page);
  const hand = page.locator('.own-hand-fan');
  const battlefieldCard = page.locator('.mat-southWest .board-card-wrap').first();
  const box = (await battlefieldCard.boundingBox())!;
  const bounds = (await hand.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2 - 10);
  await expect(page.locator('.drag-floating-card')).toBeVisible();
  await expect(page.locator('.mat-southWest')).toHaveClass(/is-drop-ready is-drop-hovered/);
  await expect(page.locator('.mat-southWest')).toHaveCSS('outline-color', 'rgb(228, 247, 152)');
  await expect(page.locator('.physical-graveyard[data-seat="southWest"]')).toHaveClass(/is-drop-ready/);
  await expect(page.locator('.physical-graveyard[data-seat="southWest"]')).toHaveCSS('outline-color', 'rgb(117, 197, 162)');
  await expect(page.locator('.physical-graveyard[data-seat="northWest"]')).not.toHaveClass(/is-drop-ready/);
  await expect(page.locator('.stack-cards')).not.toHaveClass(/is-drop-ready/);
  await expect(hand).not.toHaveClass(/is-expanded/);
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height - 12, { steps: 5 });
  await expect(hand).toHaveClass(/is-expanded/);
  // The captured target remains the battlefield card throughout both moves.
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 10);
  await expect(hand).toHaveClass(/is-expanded/);
  await expect(hand.locator('.own-hand-hit-area')).toHaveCSS('outline-style', 'none');
  await page.mouse.up();
  await expect(hand.locator('.fan-card')).toHaveCount(8);
  await expect(page.locator('.drag-floating-card')).toHaveCount(0);
  await expect(page.locator('.physical-graveyard[data-seat="southWest"]')).not.toHaveClass(/is-drop-ready/);
});

test('collapses a hand-origin drag, reopens on return and handles cancellation', async ({ page }) => {
  await harness(page);
  await revealHand(page);
  const hand = page.locator('.own-hand-fan');
  const card = hand.locator('.fan-card').last();
  const box = (await card.boundingBox())!;
  const bounds = (await hand.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 7, box.y + box.height / 2, { steps: 1 });
  await expect(hand).not.toHaveClass(/is-expanded/);
  await expect(page.locator('.drag-floating-card')).toBeVisible();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y - 30, { steps: 5 });
  await expect(hand).not.toHaveClass(/is-expanded/);
  await expect(page.locator('.drag-floating-card')).toBeVisible();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height - 12, { steps: 5 });
  await expect(hand).toHaveClass(/is-expanded/);
  await card.dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse' });
  await expect(hand).not.toHaveClass(/is-expanded/);
  await expect(page.locator('.drag-floating-card')).toHaveCount(0);
  await expect(page.locator('.mat-southWest')).not.toHaveClass(/is-drop-ready/);
  await page.mouse.up();
});

test('allows a hand card to drop onto the playmat after retracting', async ({ page }) => {
  await harness(page);
  await revealHand(page);
  const hand = page.locator('.own-hand-fan');
  const card = hand.locator('.fan-card').last();
  const id = await card.getAttribute('data-menu-card');
  const box = (await card.boundingBox())!;
  const target = (await page.locator('.mat-southWest .board-card-wrap').first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
  await expect(page.locator('.mat-southWest')).toHaveClass(/is-drop-ready is-drop-hovered/);
  await expect(page.locator('.mat-southWest')).toHaveCSS('outline-color', 'rgb(228, 247, 152)');
  await expect(page.locator('.stack-cards')).toHaveClass(/is-drop-ready/);
  await expect(hand.locator('.own-hand-hit-area')).toHaveCSS('outline-style', 'none');
  await expect(hand).not.toHaveClass(/is-expanded/);
  const topStrip = await page.locator('.mat-southWest').evaluate(mat => {
    const outer = mat.getBoundingClientRect();
    const inner = mat.querySelector('.battlefield-cards')!.getBoundingClientRect();
    const x = (outer.left + outer.right) / 2;
    for (let y = outer.top + 8; y < inner.top - 4; y += 4) {
      if (document.elementFromPoint(x, y)?.closest('.player-mat') === mat) return { x, y };
    }
    return null;
  });
  expect(topStrip).not.toBeNull();
  await page.mouse.move(topStrip!.x, topStrip!.y, { steps: 5 });
  await expect(page.locator('.mat-southWest')).toHaveClass(/is-drop-ready is-drop-hovered/);
  await page.mouse.up();
  await expect(page.locator(`.mat-southWest .board-card-wrap[data-card-id="${id}"]`)).toBeVisible();
  await expect(hand.locator('.fan-card')).toHaveCount(6);
});

test('opens for keyboard focus but mouse selection does not pin the hand', async ({ page }) => {
  await harness(page);
  const hand = page.locator('.own-hand-fan');
  // Start immediately before the hand in the real tab order.
  await page.locator('.commander-zone').last().focus();
  await page.keyboard.press('Tab');
  // Focus a hand card with keyboard modality still active.
  await hand.locator('.fan-card').last().focus();
  await expect(hand).toHaveClass(/is-expanded/);
  await page.keyboard.press('Enter');
  await expect(hand.locator('.fan-card').last()).toHaveClass(/selected/);
  await page.locator('.table-stage').focus();
  await expect(hand).not.toHaveClass(/is-expanded/);
  await revealHand(page);
  await hand.locator('.fan-card').last().click();
  await page.mouse.move(5, 5);
  await expect(hand).not.toHaveClass(/is-expanded/);
});

test('holds the hand open for its inspection and context menu', async ({ page }) => {
  await harness(page);
  await revealHand(page);
  const hand = page.locator('.own-hand-fan');
  const card = hand.locator('.fan-card').last();
  await card.hover();
  await page.keyboard.press('z');
  await expect(page.locator('.shared-card-inspection')).toBeVisible();
  await page.mouse.move(5, 5);
  await expect(hand).toHaveClass(/is-expanded/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.shared-card-inspection')).toHaveCount(0);
  await expect(hand).not.toHaveClass(/is-expanded/);
  await revealHand(page);
  await card.click({ button: 'right' });
  await page.mouse.move(5, 5);
  await expect(hand).toHaveClass(/is-expanded/);
  await page.keyboard.press('Escape');
  await expect(hand).not.toHaveClass(/is-expanded/);
});

test('remeasures different hand sizes and viewports and resets when empty or the match changes', async ({ page }) => {
  await harness(page);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const count of [1, 7, 20]) {
      await page.evaluate(count => {
        const { state } = (window as any).handFixture;
        const seat = state.value.seats.find((seat: any) => seat.id === 'southWest');
        while (seat.hand.length > count) seat.library.push(seat.hand.pop());
        while (seat.hand.length < count) seat.hand.push(seat.library.pop());
        for (const id of seat.hand) state.value.cards[id].zone = 'hand';
      }, count);
      await expect(page.locator('.fan-card')).toHaveCount(count);
      await expect.poll(() => peekHeight(page)).toBeGreaterThanOrEqual(27);
      expect(await peekHeight(page)).toBeLessThanOrEqual(28);
    }
  }
  await revealHand(page);
  await page.evaluate(() => { (window as any).handFixture.state.value.id += '-next'; });
  await expect(page.locator('.own-hand-fan')).not.toHaveClass(/is-expanded/);
  await revealHand(page);
  await page.evaluate(() => { (window as any).handFixture.seatId.value = 'northWest'; });
  await expect(page.locator('.own-hand-fan')).not.toHaveClass(/is-expanded/);
  await page.evaluate(() => { (window as any).handFixture.seatId.value = 'southWest'; });
  await revealHand(page);
  await page.evaluate(() => { (window as any).handFixture.state.value.seats.find((seat: any) => seat.id === 'southWest').hand = []; });
  await expect(page.locator('.own-hand-fan')).toHaveCount(0);
  await page.keyboard.press('Control+d');
  await expect(page.locator('.shared-card-inspection')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.shared-card-inspection')).toHaveCount(0);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.mouse.move(5, 5);
  await expect(page.locator('.own-hand-fan')).not.toHaveClass(/is-expanded/);
});

test('animates for 180ms and retracts on window blur', async ({ page }) => {
  await harness(page, false);
  const hand = page.locator('.own-hand-fan');
  await expect(hand.locator('.own-hand-cards')).toHaveCSS('transition-duration', '0.18s');
  await revealHand(page);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(hand).not.toHaveClass(/is-expanded/);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(hand).not.toHaveClass(/is-expanded/);
});

test.describe('touch hand', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test('retracts while dragging by touch and clears a cancelled reveal gesture', async ({ page }) => {
    await harness(page);
    const hand = page.locator('.own-hand-fan');
    const bounds = (await hand.boundingBox())!;
    const touch = await page.context().newCDPSession(page);
    const peek = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height - 12 };
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [peek] });
    await expect(hand).toHaveClass(/is-expanded/);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await expect(hand).not.toHaveClass(/is-expanded/);
    await revealHand(page, true);
    const card = (await hand.locator('.fan-card').last().boundingBox())!;
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: card.x + card.width / 2, y: card.y + card.height / 2 }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: peek.x, y: bounds.y - 35 }] });
    await expect(hand).not.toHaveClass(/is-expanded/);
    await expect(page.locator('.drag-floating-card')).toBeVisible();
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [peek] });
    await expect(hand).toHaveClass(/is-expanded/);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(hand).toHaveClass(/is-expanded/);
    await expect(page.locator('.drag-floating-card')).toHaveCount(0);
    await page.touchscreen.tap(5, 150);
    await expect(hand).not.toHaveClass(/is-expanded/);
  });

  test('consumes the first tap, selects on the second and collapses when tapping outside', async ({ page }) => {
    await harness(page);
    const hand = page.locator('.own-hand-fan');
    await revealHand(page, true);
    await expect(hand.locator('.selected')).toHaveCount(0);
    await expect(page.locator('.drag-floating-card')).toHaveCount(0);
    await hand.locator('.fan-card').last().tap();
    await expect(hand.locator('.selected')).toHaveCount(1);
    await page.touchscreen.tap(5, 150);
    await expect(hand).not.toHaveClass(/is-expanded/);
    await revealHand(page, true);
    await page.evaluate(() => { const state = (window as any).handFixture.state.value; state.phase = 'mulligan'; state.seats.find((seat: any) => seat.id === 'southWest').mulligans = 2; });
    await hand.locator('.fan-card').last().tap();
    await expect(hand.locator('.mulligan-bottom')).toHaveCount(1);
  });
});
