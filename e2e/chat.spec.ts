import { expect, test } from './fixtures';
import { preconFixtureDecks } from '../tests/fixtures/precons';
import { startDemoMatch } from '../src/services/demo';

test('composes chat in the lobby and shows bubbles through the table transition', async ({ page }) => {
  const deck = preconFixtureDecks()[0];
  await page.goto('/');
  await page.evaluate(async selected => {
    const { localRepository } = await import('/src/services/storage.ts');
    await localRepository.saveDeck(selected);
    await localRepository.setPreference('player-name', 'Lia');
    await localRepository.setPreference('selected-deck-id', selected.id);
  }, deck);
  await page.reload();
  await page.evaluate(async () => {
    const resources = performance.getEntriesByType('resource').map(entry => entry.name);
    const { roomBackend } = await import(resources.find(url => url.includes('/src/services/roomBackend.ts')) ?? '/src/services/roomBackend.ts');
    const { peerRoom } = await import(resources.find(url => url.includes('/src/services/peerRoom.ts')) ?? '/src/services/peerRoom.ts');
    Object.defineProperty(roomBackend, 'isConfigured', { get: () => true });
    Object.defineProperty(roomBackend, 'uid', { get: () => 'player' });
    roomBackend.connectIdentity = async () => 'player';
    roomBackend.watchDirectory = () => () => {};
    roomBackend.list = async () => ({ rooms: [], nextCursor: null });
    roomBackend.create = async () => ({ roomId: 'chat-test', code: 'CHATTEST', member: { uid: 'player', name: 'Lia', role: 'player', seatId: 'southWest', ready: false, joinedAt: 0 }, generation: 1, hostUid: 'player' });
    const snapshot = { online: true, selfSeatId: 'southWest', seats: { southWest: { uid: 'player', name: 'Lia', online: true, joinedAt: 0 } }, queue: [], hostUid: 'player' };
    const control: { update?: (snapshot: unknown) => void; snapshot: typeof snapshot } = { snapshot };
    (window as any).chatTest = control;
    peerRoom.connect = async (_room, _name, update) => { control.update = update; update(control.snapshot); return control.snapshot as any; };
    peerRoom.saveDeck = async () => {};
    peerRoom.sendChat = async text => { peerRoom.dispatchEvent(new CustomEvent('chat-message', { detail: { id: crypto.randomUUID(), uid: 'player', seatId: 'southWest', text, at: Date.now() } })); };
  });
  await page.getByRole('button', { name: 'Criar mesa', exact: true }).click();
  await page.getByRole('button', { name: 'Criar mesa e entrar', exact: true }).click();
  await expect(page.locator('.lobby-shell')).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Diga algo' })).toBeVisible();
  const input = page.getByRole('textbox', { name: 'Mensagem' });
  await input.fill('a'.repeat(100) + '👨‍👩‍👧‍👦');
  await expect(input).toHaveValue('a'.repeat(100));
  await expect(page.locator('.chat-composer-footer')).toContainText('100/100');
  await input.fill('Oi ');
  await page.getByRole('button', { name: 'Escolher emoji' }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '🃏' }).focus();
  await page.keyboard.press('Enter');
  await input.press('Enter');
  await expect(page.locator('.lobby-table-preview .chat-bubble')).toContainText('Oi 🃏');
  const state = startDemoMatch('Lia', preconFixtureDecks());
  await page.evaluate(next => {
    const control = (window as any).chatTest;
    control.snapshot = { ...control.snapshot, state: next };
    control.update(control.snapshot);
  }, state);
  await expect(page.locator('.table-shell .chat-bubble')).toContainText('Oi 🃏');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.table-shell .chat-bubble')).toBeVisible();
  const bubble = await page.locator('.table-shell .chat-bubble').boundingBox();
  const stage = await page.locator('.table-stage').boundingBox();
  expect(bubble && stage && bubble.x >= stage.x && bubble.x + bubble.width <= stage.x + stage.width && bubble.y >= stage.y && bubble.y + bubble.height <= stage.y + stage.height).toBe(true);
  await page.evaluate(() => {
    const control = (window as any).chatTest;
    control.snapshot = { ...control.snapshot, selfSeatId: undefined };
    control.update(control.snapshot);
  });
  await expect(page.locator('.chat-open-button')).toHaveCount(0);
  await expect(page.locator('.table-shell .chat-bubble')).toContainText('Oi 🃏');
});
