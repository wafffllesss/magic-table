import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { fixtureDecks } from '../tests/fixtures/scryfall';
import { preconFixtureDecks } from '../tests/fixtures/precons';

async function openConnectedLibrary(page: Page, decks = preconFixtureDecks()): Promise<void> {
  await page.goto('/');
  await page.evaluate(async decks => {
    const { localRepository } = await import('/src/services/storage.ts');
    const { peerRoom } = await import(performance.getEntriesByType('resource').map(entry => entry.name).find(url => url.includes('/src/services/peerRoom.ts')) ?? '/src/services/peerRoom.ts');
    const { roomBackend } = await import(performance.getEntriesByType('resource').map(entry => entry.name).find(url => url.includes('/src/services/roomBackend.ts')) ?? '/src/services/roomBackend.ts');
    Object.defineProperty(roomBackend, 'isConfigured', { get: () => true });
    roomBackend.connectIdentity = async () => 'test-player';
    roomBackend.watchDirectory = () => () => {};
    roomBackend.list = async () => ({ rooms: [], nextCursor: null });
    roomBackend.create = async () => ({ roomId: 'test', code: 'TESTROOM', member: { uid: 'test-player', name: 'Lia', seatId: 'northWest', role: 'player', ready: false, joinedAt: 0 }, generation: 1 });
    for (const deck of decks) await localRepository.saveDeck(deck);
    const snapshot = {
      online: true, selfSeatId: 'northWest', queue: [],
      seats: { northWest: { uid: 'test-player', name: 'Lia', online: true, joinedAt: 0 } },
    };
    const control = { updates: undefined as undefined | ((room: unknown) => void), snapshot, failSave: false, savedDeckIds: [] as string[] };
    (window as any).lobbyTest = control;
    peerRoom.connect = async (_joined, _name, receive) => {
      control.updates = receive;
      receive(JSON.parse(JSON.stringify(control.snapshot)));
      return JSON.parse(JSON.stringify(control.snapshot));
    };
    peerRoom.saveDeck = async deck => {
      if (control.failSave) throw new Error('Não foi possível sincronizar o deck.');
      control.savedDeckIds.push(deck.id);
      Object.assign(control.snapshot.seats.northWest, {
        deckName: deck.name, deckSummary: deck.entries.filter(entry => entry.role === 'commander'),
      });
      control.updates!(JSON.parse(JSON.stringify(control.snapshot)));
    };
  }, decks);
  await page.getByLabel('Seu nome', { exact: true }).fill('Lia');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.locator('.starter-card').last().getByRole('button', { name: /^Escolher / }).click();
  await page.getByRole('button', { name: 'Criar mesa', exact: true }).click();
  await page.getByRole('button', { name: 'Criar mesa e entrar', exact: true }).click();
  await page.getByRole('button', { name: /Trocar deck/ }).click();
  await page.evaluate(() => { (window as any).lobbyTest.savedDeckIds = []; });
  const missingPrecons = preconFixtureDecks().filter(precon => !decks.some(deck => deck.id === precon.id)).length;
  await expect(page.locator('.starter-card')).toHaveCount(decks.length + missingPrecons);
}

test('opens a deck for inspection without applying it, and keeps its detail open after a save error', async ({ page }) => {
  await openConnectedLibrary(page);
  const partnerDeck = page.locator('.starter-card').filter({ hasText: 'Grave Danger' });
  await partnerDeck.getByRole('button', { name: /Detalhes de/ }).click();
  await expect(page.locator('.deck-inspection-page')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Grave Danger' })).toBeVisible();
  await expect(page.locator('.deck-type-column').first()).toHaveAttribute('aria-label', /Comandantes/);
  expect(await page.evaluate(() => (window as any).lobbyTest.savedDeckIds)).toEqual([]);

  await page.evaluate(() => { (window as any).lobbyTest.failSave = true; });
  await page.getByRole('button', { name: /Usar este deck/ }).click();
  await expect(page.locator('.toast-message')).toContainText('Não foi possível sincronizar o deck.');
  await expect(page.locator('.deck-inspection-page')).toBeVisible();
  await expect(page.getByRole('button', { name: /Voltar à biblioteca/ })).toBeVisible();

  await page.evaluate(() => { (window as any).lobbyTest.failSave = false; });
  await page.getByRole('button', { name: /Usar este deck/ }).click();
  await expect(page.locator('.lobby-shell')).toBeVisible();
  await expect(page.locator('.seat-self .commander-thumbnail')).toHaveCount(1);
  await expect(page.locator('.seat-self').getByAltText('Gisa and Geralf')).toHaveAttribute('src', /^blob:/);
  expect(await page.evaluate(() => (window as any).lobbyTest.savedDeckIds)).toEqual(['precon-scd-grave-danger']);
});

test('groups the deck into horizontally scrolling type columns and inspects a card accessibly', async ({ page }) => {
  const decks = preconFixtureDecks();
  const targetDeck = decks[0];
  targetDeck.id = 'test-type-columns';
  targetDeck.name = 'Inspection fixture deck';
  targetDeck.id = 'personal-deck';
  const cards = decks[0].entries;
  const kinds = ['Artifact', 'Enchantment', 'Instant', 'Sorcery', 'Planeswalker', 'Battle', 'Land'];
  kinds.forEach((kind, index) => { cards[index + 1].card!.type_line = kind; });
  cards[1].quantity = 2;
  cards[3].card!.card_faces = [
    { name: `${cards[3].name} front`, mana_cost: '{1}', type_line: 'Instant', oracle_text: 'Front face.', image_uris: cards[3].card!.image_uris },
    { name: `${cards[3].name} back`, mana_cost: '', type_line: 'Land', oracle_text: 'Back face.', image_uris: cards[3].card!.image_uris },
  ];
  delete cards[8].card;
  await openConnectedLibrary(page, decks);
  await page.locator('.starter-card').filter({ hasText: targetDeck.name }).getByRole('button', { name: /Detalhes de/ }).click();
  await expect(page.locator('.deck-type-column')).toHaveCount(10);
  await expect(page.locator('.deck-type-column').first()).toContainText('Comandantes');
  await expect(page.locator('.deck-type-column').nth(1)).toContainText('Criaturas');
  await expect(page.locator('.deck-type-column').filter({ hasText: 'Artefatos' })).toContainText('2');
  await expect(page.locator('.deck-type-column').last()).toContainText('Outros');
  expect(await page.locator('.deck-columns-scroll').evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);

  const creatureEntry = cards.find(entry => entry.role === 'library' && entry.card?.type_line.startsWith('Creature'))!;
  const inspected = page.getByRole('button', { name: `Inspecionar ${creatureEntry.name}` });
  await inspected.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toContainText(creatureEntry.name);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(inspected).toBeFocused();
  await page.getByRole('button', { name: `Inspecionar ${cards[3].name}` }).click({ position: { x: 20, y: 18 } });
  await page.getByRole('button', { name: `${cards[3].name} back` }).click();
  await expect(page.getByRole('dialog')).toContainText('Back face.');
  await expect(page.getByRole('dialog').getByAltText(`${cards[3].name} back`)).toBeVisible();
  await page.getByRole('button', { name: 'Fechar inspeção' }).click();
  await page.getByRole('button', { name: /Voltar à biblioteca/ }).click();
  await expect(page.locator('.starter-deck-grid')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.starter-card').first().getByRole('button', { name: /Detalhes de/ }).click();
  await expect(page.locator('.deck-columns-scroll')).toBeVisible();
  expect(await page.locator('.deck-columns-scroll').evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
});

test('preserves the open editor and import draft during room and game updates, then returns to the latest game', async ({ page }) => {
  await openConnectedLibrary(page);
  await page.getByRole('tab', { name: 'Importar' }).click();
  const draft = 'Commander:\n1 Meu comandante\n\nDeck:\n35 Plains';
  await page.getByLabel('SUA LISTA').fill(draft);
  await page.evaluate(async decks => {
    const control = (window as any).lobbyTest;
    control.updates({ ...control.snapshot, online: false });
    const { newMatch } = await import('/src/domain/game.ts');
    const ids = ['northWest', 'northEast', 'southEast', 'southWest'];
    const state = newMatch(decks.map((deck, index) => ({ seatId: ids[index], name: `Player ${index}`, deck })));
    control.updates({ ...control.snapshot, state });
  }, fixtureDecks());
  await expect(page.locator('.workshop-shell')).toBeVisible();
  await expect(page.getByLabel('SUA LISTA')).toHaveValue(draft);
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.locator('.table-shell')).toBeVisible();
  await expect(page.locator('.player-mat')).toHaveCount(4);
});
