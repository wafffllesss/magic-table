import { preconFixtureDecks } from '../tests/fixtures/precons';
import { openLibrary, revealHand, startLocalDemo } from './navigation';
import { expect, test } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async decks => {
    const { localRepository } = await import('/src/services/storage.ts');
    for (const deck of decks) await localRepository.saveDeck(deck);
  }, preconFixtureDecks());
});

test('starts the local Commander table and provides four seats', async ({ page }) => {
  await startLocalDemo(page);
  await expect(page.getByText('DEMONSTRAÇÃO LOCAL')).toBeVisible();
  await expect(page.locator('.player-mat')).toHaveCount(4);
  await expect(page.locator('.mat-header')).toHaveCount(0);
  await expect(page.locator('.seat-nameplate')).toHaveCount(3);
  await expect(page.locator('.seat-nameplate .player-dot.is-offline')).toHaveCount(3);
  await expect(page.getByRole('group', { name: /Pool de mana/ })).toHaveCount(0);
  await expect(page.locator('.mat-southWest')).toHaveClass(/is-self/);
  await expect(page.locator('.own-hand-fan .fan-card')).toHaveCount(7);
});

test('shows five recent events and opens every retained log entry in an accessible dialog', async ({ page }) => {
  await startLocalDemo(page);
  const preview = page.locator('.action-log-preview');
  await expect(preview.locator('.action-log-preview-entry')).toHaveCount(1);
  const increaseLife = page.locator('.seat-life-panel button').nth(1);
  for (let index = 0; index < 6; index++) await increaseLife.click({ force: true });
  await expect(preview.locator('.action-log-preview-entry')).toHaveCount(5);
  await preview.locator('.action-log-open').click();
  const dialog = page.getByRole('dialog', { name: 'Histórico de ações' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.log-entry')).toHaveCount(7);
  const dialogEvents = await dialog.locator('.log-entry').allTextContents();
  expect(dialogEvents[0]).toContain('Uma partida de demonstração está em andamento.');
  expect(dialogEvents.at(-1)).toContain('Lia');
  const previewEvents = await preview.locator('.action-log-preview-entry').allTextContents();
  expect(previewEvents.at(-1)).toContain('Lia');
  await expect(dialog.getByRole('button', { name: 'Fechar histórico' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(preview.locator('.action-log-open')).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(preview).toBeVisible();
  await expect(preview.locator('.action-log-preview-entry')).toHaveCount(5);
  await preview.locator('.action-log-open').click();
  await expect(page.getByRole('dialog', { name: 'Histórico de ações' })).toBeVisible();
});

test('keeps four places visible with two players and honors reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const mounted = await page.evaluate(async () => {
    const vueModuleUrl = performance.getEntriesByType('resource').map(entry => entry.name).find(url => url.includes('/node_modules/.vite/deps/vue.js')) ?? '/node_modules/.vite/deps/vue.js';
    const { createApp } = await import(vueModuleUrl);
    const { default: GameTable } = await import('/src/components/GameTable.vue');
    await (await import('/src/services/storage.ts')).localRepository.setPreference('hide-table-tutorial', true);
    const host = document.createElement('div');
    host.className = 'virtual-hand-test-host';
    host.style.cssText = 'position:fixed;inset:0;z-index:1000';
    document.body.append(host);
    const ids = ['northWest', 'southWest'];
    const seats = ids.map(id => ({ id, name: id === 'southWest' ? 'Lia' : id, status: 'playing', commanderIds: [], library: [], hand: [], mulligans: 0, keptHand: true, life: 40, poison: 0, commanderCasts: {}, commanderDamage: {}, landPlays: 0 }));
    const state = { id: 'hand-e2e', revision: 0, phase: 'playing', paused: false, activeSeatId: 'southWest', turn: 1, step: 'Principal pré-combate', seats, cards: { fixtureCard: { id: 'fixtureCard', ownerId: 'southWest', controllerId: 'southWest', cardId: 'fixtureCard', zone: 'battlefield', tapped: false, faceDown: false, x: 42, y: 38, counters: {}, card: { id: 'fixtureCard', oracle_id: 'fixtureCard', name: 'Test Forest', layout: 'normal', color_identity: ['G'], keywords: [], mana_cost: '', type_line: 'Basic Land — Forest', oracle_text: '', legalities: {} } } }, stack: [], passes: [], log: [], updatedAt: Date.now() };
    createApp(GameTable, { state, seatId: 'southWest', playmatIds: {}, online: false }).mount(host);
    return state.seats.length;
  });
  expect(mounted).toBe(2);
  const host = page.locator('.virtual-hand-test-host');
  const virtualHands = host.locator('.hand-stage-layer .virtual-hand');
  await expect(host.locator('.seat-place')).toHaveCount(4);
  await expect(host.locator('.empty-seat')).toHaveCount(2);
  await expect(host.locator('.seat-place .library-pile')).toHaveCount(2);
  await expect(virtualHands).toHaveCount(1);
  const card = host.locator('.mat-southWest .board-card-wrap').first();
  await card.click();
  await expect(card.locator('.card-pose')).toHaveCSS('animation-name', 'none');
  const box = await card.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 35, box!.y + box!.height / 2 + 20, { steps: 4 });
  await expect(page.locator('.drag-floating-card')).toBeVisible();
  await page.mouse.up();
});

test('hides deck and hand from empty places on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.evaluate(async () => {
    const vueModuleUrl = performance.getEntriesByType('resource').map(entry => entry.name).find(url => url.includes('/node_modules/.vite/deps/vue.js')) ?? '/node_modules/.vite/deps/vue.js';
    const { createApp } = await import(vueModuleUrl);
    const { default: GameTable } = await import('/src/components/GameTable.vue');
    await (await import('/src/services/storage.ts')).localRepository.setPreference('hide-table-tutorial', true);
    const host = document.createElement('div');
    host.className = 'narrow-empty-seat-test-host';
    host.style.cssText = 'position:fixed;inset:0;z-index:1000';
    document.body.append(host);
    const seats = ['northWest', 'southWest'].map(id => ({ id, name: id, status: 'playing', commanderIds: [], library: [], hand: [], mulligans: 0, keptHand: true, life: 40, poison: 0, commanderCasts: {}, commanderDamage: {}, landPlays: 0 }));
    const state = { id: 'narrow-empty-seat-test', revision: 0, phase: 'playing', paused: false, activeSeatId: 'southWest', turn: 1, step: 'Principal pré-combate', seats, cards: {}, stack: [], passes: [], log: [], updatedAt: Date.now() };
    createApp(GameTable, { state, seatId: 'southWest', playmatIds: {}, online: false }).mount(host);
  });
  const host = page.locator('.narrow-empty-seat-test-host');
  await expect(host.locator('.seat-place')).toHaveCount(4);
  await expect(host.locator('.empty-seat')).toHaveCount(2);
  await expect(host.locator('.seat-place .library-pile')).toHaveCount(2);
  await expect(host.locator('.hand-stage-layer .virtual-hand')).toHaveCount(1);
});

test('supports drawing, selection, card inspection and help shortcuts', async ({ page }) => {
  await startLocalDemo(page);
  const hand = page.locator('.own-hand-fan .fan-card');
  await expect(hand).toHaveCount(7);
  await page.keyboard.press('Control+d');
  await expect(hand).toHaveCount(8);
  await page.keyboard.press('Escape');
  await revealHand(page);
  await page.locator('.fan-card').last().click();
  await expect(page.locator('.fan-card').last()).toHaveClass(/selected/);
  await expect(page.locator('.selected-card-controls')).toHaveCount(0);
  await page.locator('.fan-card').last().hover();
  await page.keyboard.press('z');
  await expect(page.locator('.shared-card-inspection')).toBeVisible({ timeout: 3500 });
  const inspectionHand = page.locator('.app-global-cursor');
  await expect(inspectionHand).toBeVisible();
  await expect(inspectionHand).toHaveCSS('--hand-angle', '0deg');
  const hoveredCard = await page.locator('.fan-card').last().boundingBox();
  expect(hoveredCard).not.toBeNull();
  expect(await inspectionHand.evaluate(element => element.getBoundingClientRect().left)).toBeCloseTo(hoveredCard!.x + hoveredCard!.width / 2 - 14, 0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.shared-card-inspection')).toHaveCount(0);
  await page.keyboard.press('?');
  await expect(page.locator('.help-modal')).toContainText('CTRL');
  await page.keyboard.press('Escape');
  await expect(page.locator('.help-modal')).toBeHidden();
});

test('groups library and general controls around the table on desktop and mobile', async ({ page }) => {
  await startLocalDemo(page);
  await expect(page.locator('.deck-actions')).toBeVisible();
  await expect(page.locator('.deck-actions button')).toHaveCount(3);
  await expect(page.locator('.general-actions')).toBeVisible();
  await expect(page.locator('.quick-actions')).toHaveCount(0);
  await expect(page.locator('.self-table-tools .commander-note')).toBeVisible();
  await expect(page.locator('.game-sidebar, .sidebar-toggle')).toHaveCount(0);
  const placement = await page.locator('.self-table-tools').evaluate(element => {
    const tools = element as HTMLElement;
    const mat = tools.parentElement!.querySelector('.player-mat') as HTMLElement;
    const commander = tools.parentElement!.querySelector('.seat-zones-right') as HTMLElement;
    const note = tools.querySelector('.commander-note')!;
    return { gap: tools.offsetLeft - mat.offsetWidth, top: tools.offsetTop, commanderBottom: commander.offsetTop + commander.offsetHeight, rotation: getComputedStyle(note).transform };
  });
  expect(placement.gap).toBeGreaterThan(0);
  expect(placement.top).toBeGreaterThan(placement.commanderBottom);
  expect(placement.rotation).not.toBe('none');
  const hand = page.locator('.own-hand-fan .fan-card');
  await page.getByRole('button', { name: 'Comprar carta', exact: true }).click();
  await expect(hand).toHaveCount(8);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Buscar na biblioteca' }).click();
  await expect(page.locator('.library-search-modal')).toBeVisible();
  await page.locator('.library-search-modal .modal-close').click();
  await page.locator('.action-log-open').click();
  await expect(page.getByRole('dialog', { name: 'Histórico de ações' })).toBeVisible();
  await page.getByRole('button', { name: 'Fechar histórico' }).click();
  await page.screenshot({ path: 'test-results/table-controls-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.general-actions')).toBeVisible();
  await expect(page.locator('.self-table-tools .commander-note')).toBeVisible();
});

test('keeps the local seat in front while the camera moves and playmat choice persists', async ({ page }) => {
  await startLocalDemo(page);
  const stage = page.locator('.table-stage');
  const mat = page.locator('.mat-southWest');
  await expect(mat).toHaveCSS('width', '816px');
  await expect(page.locator('.player-mat')).toHaveCount(4);
  const handBefore = await page.locator('.own-hand-fan').boundingBox();
  const cameraBefore = await page.locator('.camera-scene').evaluate(node => (node as HTMLElement).style.transform);
  await stage.hover({ position: { x: 300, y: 250 } });
  await expect.poll(async () => page.locator('.camera-scene').evaluate(node => (node as HTMLElement).style.transform)).not.toBe(cameraBefore);
  await stage.evaluate(node => node.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true })));
  const handAfter = await page.locator('.own-hand-fan').boundingBox();
  expect(handAfter).toEqual(handBefore);
  await page.getByRole('button', { name: 'Personalizar playmat' }).click();
  await page.locator('.playmat-choice').filter({ hasText: 'Azorius' }).click();
  await page.getByRole('button', { name: 'Aplicar playmat' }).click();
  await expect(mat.locator('.playmat-art')).toHaveAttribute('data-image-width', '1600');
  await expect(mat.locator('.playmat-art img')).toHaveAttribute('src', /^blob:/);
  await page.getByRole('button', { name: 'Configurações' }).click();
  const disablePlaymats = page.getByRole('checkbox', { name: /Desativar todos os playmats personalizados/ });
  await disablePlaymats.check();
  await expect(mat.locator('.playmat-art')).toHaveCount(0);
  await expect.poll(() => page.evaluate(async () => {
    const { localRepository } = await import('/src/services/storage.ts');
    return localRepository.getPreference('disable-custom-playmats');
  })).toBe(true);
  await page.reload();
  await startLocalDemo(page);
  const restoredMat = page.locator('.mat-southWest');
  await expect(restoredMat.locator('.playmat-art')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Configurações' }).click();
  await expect(page.getByRole('dialog', { name: 'Configurações' })).toBeVisible();
  await page.getByRole('checkbox', { name: /Desativar todos os playmats personalizados/ }).uncheck();
  await expect(restoredMat.locator('.playmat-art')).toHaveAttribute('data-image-width', '1600');
});

test('repositions a card on the rotated local mat', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await startLocalDemo(page);
  const card = page.locator('.mat-southWest .board-card-wrap').first();
  const before = await card.getAttribute('style');
  const box = await card.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 45, box!.y + box!.height / 2 - 25, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => card.getAttribute('style')).not.toBe(before);
});

test('keeps the camera at the local seat through a turn change and honors reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await startLocalDemo(page);
  const camera = page.locator('.camera-scene');
  const initialView = await camera.evaluate(node => (node as HTMLElement).style.transform);
  await page.locator('.table-stage').hover({ position: { x: 300, y: 250 } });
  expect(await camera.evaluate(node => (node as HTMLElement).style.transform)).toBe(initialView);
  if (await page.getByRole('button', { name: /PASSAR PRIORIDADE/ }).count()) {
    await page.getByRole('button', { name: /PASSAR PRIORIDADE/ }).click();
  }
  await expect(page.locator('.table-hub')).toContainText('RESOLVIDO');
  for (const step of ['Combate', 'Principal pós-combate', 'Final']) {
    await page.getByRole('button', { name: 'Próxima etapa' }).click();
    await expect(page.locator('.turn-timeline li.is-current b')).toHaveText(step);
  }
  await page.getByRole('button', { name: 'Encerrar turno' }).click();
  await expect(page.locator('.turn-timeline')).not.toHaveClass(/is-own-turn/);
  expect(await camera.evaluate(node => (node as HTMLElement).style.transform)).toBe(initialView);
});

test('keeps the table usable on a narrow desktop-sized window', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startLocalDemo(page);
  await expect(page.locator('.game-sidebar, .sidebar-toggle')).toHaveCount(0);
  await expect(page.locator('.self-table-tools')).toBeVisible();
  await expect(page.locator('.table-hub')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sair da mesa' })).toBeVisible();
});

test('tracks camera movement with the pointer and freezes it during inspection and menus', async ({ page }) => {
  await startLocalDemo(page);
  const stage = page.locator('.table-stage');
  const camera = page.locator('.camera-scene');
  const bounds = await stage.boundingBox();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + 12);
  await expect.poll(async () => Number(await stage.getAttribute('data-lean'))).toBeGreaterThan(.8);
  const card = page.locator('.fan-card').last();
  await revealHand(page);
  await card.hover();
  await page.keyboard.press('z');
  const frozen = await camera.getAttribute('style');
  await page.waitForTimeout(220);
  expect(await camera.getAttribute('style')).toBe(frozen);
  await page.keyboard.press('Escape');
  await expect(page.locator('.shared-card-inspection')).toHaveCount(0);
  await card.click({ button: 'right' });
  await expect(page.getByRole('menu')).toBeVisible();
  const menuCamera = await camera.getAttribute('style');
  await page.mouse.move(bounds!.x + 15, bounds!.y + 10);
  expect(await camera.getAttribute('style')).toBe(menuCamera);
  await page.keyboard.press('Escape');
  await page.mouse.move(-5, bounds!.y + bounds!.height / 2);
  await expect.poll(async () => Number(await stage.getAttribute('data-lean'))).toBeLessThan(.02);
});

test('uses keyboard and card menus to rotate cards, move to public zones and inspect opponents safely', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await startLocalDemo(page);
  const own = page.locator('.mat-southWest .board-card-wrap').first();
  await own.focus();
  await page.keyboard.press('Shift+F10');
  const tap = page.getByRole('menuitem', { name: /^(Virar|Desvirar)$/ });
  const wasTapped = await own.locator('.card-pose').evaluate(node => node.classList.contains('is-tapped'));
  await tap.click();
  await expect(own.locator('.card-pose')).toHaveClass(wasTapped ? /^card-pose motion-reduced$/ : /is-tapped/);
  await own.hover();
  await page.keyboard.press('t');
  await expect(own.locator('.card-pose')).toHaveClass(wasTapped ? /is-tapped/ : /^card-pose motion-reduced$/);
  const afterKeyboardTap = await own.locator('.card-pose').evaluate(node => node.classList.contains('is-tapped'));
  await own.click({ button: 'middle' });
  await expect(own.locator('.card-pose')).toHaveClass(afterKeyboardTap ? /^card-pose motion-reduced$/ : /is-tapped/);
  await own.click();
  const selectedCardTapped = await own.locator('.card-pose').evaluate(node => node.classList.contains('is-tapped'));
  await page.locator('.table-topbar').hover();
  await page.keyboard.press('t');
  await expect(own.locator('.card-pose')).toHaveClass(selectedCardTapped ? /^card-pose motion-reduced$/ : /is-tapped/);
  await own.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Mover ao cemitério', exact: true }).click();
  const graveyardPile = page.getByRole('button', { name: /^Cemitério de Lia/ });
  await graveyardPile.click();
  const fan = page.locator('.table-stage .fan-graveyard');
  await expect(fan.locator('.public-zone-fan-card')).toHaveCount(1);
  await fan.locator('.public-zone-fan-card').click();
  await expect(page.locator('.shared-card-inspection')).toBeVisible();
  await page.getByRole('button', { name: 'Fechar inspeção', exact: true }).click();
  await fan.locator('.public-zone-fan-card').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Devolver à mão', exact: true }).click();
  await expect(fan.locator('.public-zone-fan-empty')).toHaveText('Esta zona está vazia.');
  await expect(graveyardPile).toHaveAttribute('aria-expanded', 'true');
  await graveyardPile.focus();
  await page.keyboard.press('Enter');
  await expect(graveyardPile).toHaveAttribute('aria-expanded', 'false');
  const opponent = page.locator('.mat-northWest .board-card-wrap').first();
  await opponent.focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'Mover ao cemitério' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Inspecionar' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(opponent).toBeFocused();
  const privateDeck = page.getByRole('button', { name: /^Deck de Yara/ });
  await privateDeck.focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'Biblioteca privada' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(privateDeck).toBeFocused();
});

test('shows graveyard and exile independently and closes both fans with Escape', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await startLocalDemo(page);
  const battlefieldCards = page.locator('.mat-southWest .board-card-wrap');
  await expect.poll(() => battlefieldCards.count()).toBeGreaterThanOrEqual(2);
  await battlefieldCards.first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Mover ao cemitério', exact: true }).click();
  await battlefieldCards.last().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Exilar', exact: true }).click();
  const graveyardPile = page.locator('.seat-place[data-seat="southWest"] .physical-graveyard');
  const exilePile = page.locator('.seat-place[data-seat="southWest"] .physical-exile');
  await graveyardPile.click({ position: { x: 42, y: 59 } });
  await exilePile.focus();
  await page.keyboard.press('Enter');
  await expect(graveyardPile).toHaveAttribute('aria-expanded', 'true');
  await expect(exilePile).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.table-stage .public-zone-fan')).toHaveCount(2);
  await expect(page.locator('.fan-graveyard .public-zone-fan-card')).toHaveCount(1);
  await expect(page.locator('.fan-exile .public-zone-fan-card')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(graveyardPile).toHaveAttribute('aria-expanded', 'false');
  await expect(exilePile).toHaveAttribute('aria-expanded', 'false');
});

test('opens own public zones to the side and searches any public zone', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await startLocalDemo(page);
  await page.locator('.mat-southWest .board-card-wrap').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Mover ao cemitério', exact: true }).click();
  const ownGraveyard = page.locator('.seat-place[data-seat="southWest"] .zone-pile-wrap').first();
  const ownGraveyardFan = page.locator('.table-stage .fan-graveyard');
  await expect(ownGraveyard.locator('.public-zone-actions button')).toHaveCount(2);
  await ownGraveyard.locator('.public-zone-toggle').click({ position: { x: 42, y: 59 } });
  await expect(ownGraveyardFan).toBeVisible();
  await page.getByRole('button', { name: 'Abrir Cemitério para o lado' }).click();
  await expect(ownGraveyardFan).toHaveCount(0);
  const searchButton = ownGraveyard.getByRole('button', { name: 'Buscar em Cemitério' });
  await searchButton.click();
  const dialog = page.getByRole('dialog', { name: 'Buscar em Cemitério' });
  await expect(dialog.getByRole('searchbox')).toBeFocused();
  await expect(dialog.locator('.library-search-result')).toHaveCount(1);
  await dialog.getByRole('searchbox').fill('not-a-card');
  await expect(dialog.locator('.library-no-results')).toHaveText('Nenhuma carta encontrada para esta busca.');
  await dialog.getByRole('searchbox').press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(searchButton).toBeFocused();
  const opponentGraveyard = page.locator('.seat-place[data-seat="northWest"] .physical-graveyard');
  await expect(page.locator('.seat-place[data-seat="northWest"] .public-zone-actions')).toHaveCount(0);
  await opponentGraveyard.click();
  await expect(dialog).toBeVisible();
  await expect(page.locator('.table-stage .public-zone-fan[data-seat="northWest"]')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
});

test('keeps context menus inside a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startLocalDemo(page);
  await revealHand(page);
  await page.locator('.fan-card').last().click({ button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const bounds = await menu.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(8); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(382);
  expect(bounds!.y).toBeGreaterThanOrEqual(8); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(836);
  await page.keyboard.press('Home');
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('End');
  await expect(menu.getByRole('menuitem').last()).toBeFocused();
});

test.describe('touch table controls', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test('opens card actions with a long press and cancels the gesture when moving', async ({ page }) => {
    await startLocalDemo(page);
    await revealHand(page, true);
    const card = await page.locator('.fan-card').last().boundingBox();
    const touch = await page.context().newCDPSession(page);
    const x = card!.x + card!.width / 2; const y = card!.y + card!.height / 2;
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await expect(page.getByRole('menu')).toBeVisible({ timeout: 2000 });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.keyboard.press('Escape');
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 150 }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 230, y: 100 }] });
    await page.waitForTimeout(550);
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect.poll(async () => Number(await page.locator('.table-stage').getAttribute('data-lean'))).toBeGreaterThan(.05);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  });
});

test('renders the 200-object public stress scene within the browser heap budget', async ({ page }) => {
  await page.goto('/?stress=200');
  await startLocalDemo(page);
  await expect(page.locator('.board-card-wrap[data-card-id*="-stress-"]')).toHaveCount(200);
  const heapBytes = await page.evaluate(() => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0);
  expect(heapBytes).toBeGreaterThan(0);
  expect(heapBytes).toBeLessThan(150 * 1024 * 1024);
});
