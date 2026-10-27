import { expect, test } from './fixtures';
import { preconFixtureDecks } from '../tests/fixtures/precons';
import { openLibrary } from './navigation';
import type { Page } from '@playwright/test';

async function seed(page: Page, selected = false): Promise<void> {
  await page.goto('/');
  if (await page.locator('.startup-shell').isVisible()) await page.locator('.startup-shell button').last().click();
  await expect(page.getByLabel('Seu nome', { exact: true })).toBeVisible();
  await page.evaluate(async ({ decks, selected }) => {
    const { localRepository } = await import('/src/services/storage.ts');
    await localRepository.setPreference('hide-table-tutorial', true);
    for (const deck of decks) await localRepository.saveDeck(deck);
    if (selected) {
      await localRepository.setPreference('player-name', 'Lia');
      await localRepository.setPreference('selected-deck-id', decks[0].id);
    }
  }, { decks: preconFixtureDecks(), selected });
}
async function choose(page: Page): Promise<void> {
  await openLibrary(page);
  await page.locator('.starter-card').first().getByRole('button', { name: /^Escolher / }).click();
  await expect(page.getByRole('heading', { name: 'Jogos', exact: true })).toBeVisible();
}
async function mockOnline(page: Page, phase = 'lobby'): Promise<void> {
  await page.evaluate(async phase => {
    const { roomBackend } = await import(performance.getEntriesByType('resource').map(entry => entry.name).find(url => url.includes('/src/services/roomBackend.ts')) ?? '/src/services/roomBackend.ts');
    const { peerRoom } = await import(performance.getEntriesByType('resource').map(entry => entry.name).find(url => url.includes('/src/services/peerRoom.ts')) ?? '/src/services/peerRoom.ts');
    Object.defineProperty(roomBackend, 'isConfigured', { get: () => true });
    const rooms = [
      { id: 'a', code: 'OPENROOM', name: 'Mesa aberta', hostName: 'Ana', playerCount: 2, memberCount: 2, locked: false, phase: 'lobby', createdAt: 1 },
      { id: 'b', code: 'LOCKROOM', name: 'Mesa com senha', hostName: 'Bia', playerCount: 4, memberCount: 5, locked: true, phase: 'playing', createdAt: 2 },
      { id: 'c', code: 'CLOSED00', name: 'Mesa encerrada', closed: true, playerCount: 0, memberCount: 0, locked: false, phase: 'lobby', createdAt: 3 },
    ];
    roomBackend.connectIdentity = async () => 'test';
    roomBackend.watchDirectory = receive => { receive(rooms); return () => {}; };
    roomBackend.list = async () => ({ rooms, nextCursor: null });
    const control = { saves: [] as string[], failSave: false, attempts: [] as string[], phase, receive: undefined as any, snapshot: { online: true, selfSeatId: 'northWest', queue: [], seats: { northWest: { uid: 'test', name: 'Lia', online: true, ready: false } } } };
    (window as any).onlineTest = control;
    roomBackend.join = async (code, name, password) => {
      control.attempts.push(code);
      if (code === 'LOCKROOM' && password !== 'correct') throw new Error('permission-denied');
      return { roomId: code, code, generation: 1, member: { uid: 'test', name, seatId: 'northWest', role: 'player', ready: false, joinedAt: 0 } };
    };
    peerRoom.connect = async (_joined, _name, receive) => {
      control.receive = receive;
      if (phase === 'playing') {
        const { newMatch } = await import('/src/domain/game.ts');
        const { localRepository } = await import('/src/services/storage.ts');
        const decks = await localRepository.getDecks();
        (control.snapshot as any).state = newMatch(['northWest','northEast','southEast','southWest'].map((seatId, index) => ({ seatId, name: seatId, deck: decks[index] })));
      }
      receive(control.snapshot as any); return control.snapshot as any;
    };
    peerRoom.saveDeck = async deck => {
      if (control.failSave) throw new Error('Falha ao sincronizar deck');
      control.saves.push(deck.id);
      Object.assign(control.snapshot.seats.northWest, { deckName: deck.name, deckSummary: deck.entries.filter(entry => entry.role === 'commander') });
      control.receive(JSON.parse(JSON.stringify(control.snapshot)));
    };
    peerRoom.leave = async () => {};
  }, phase);
}

test('validates name, advances with Enter and restores the chosen deck after reload', async ({ page }) => {
  await seed(page);
  await page.getByLabel('Seu nome', { exact: true }).fill(' ');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.locator('.toast-message')).toContainText('pelo menos duas');
  await page.getByLabel('Seu nome', { exact: true }).fill('  Lia   Silva ');
  await page.getByLabel('Seu nome', { exact: true }).press('Enter');
  await expect(page.locator('.workshop-shell')).toBeVisible();
  await page.locator('.starter-card').first().getByRole('button', { name: /^Escolher / }).click();
  await expect(page.locator('.room-directory-card').first()).toContainText('Demonstração local');
  await expect(page.locator('.entry-form, .workshop-shell')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Jogos', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Lia Silva · Alterar nome/ })).toBeVisible();
});

test('cancel preserves name and deck, changes persist, and demo returns to games', async ({ page }) => {
  await seed(page); await choose(page);
  const previous = await page.getByRole('button', { name: /Trocar deck/ }).innerText();
  await page.getByRole('button', { name: /Alterar nome/ }).click();
  await page.getByLabel('Seu nome', { exact: true }).fill('Outro nome');
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.getByRole('button', { name: /Lia · Alterar nome/ })).toBeVisible();
  await page.getByRole('button', { name: /Trocar deck/ }).click();
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.getByRole('button', { name: /Trocar deck/ })).toHaveText(previous);
  await page.getByRole('button', { name: /Alterar nome/ }).click();
  await page.getByLabel('Seu nome', { exact: true }).fill('Ana');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: /Ana · Alterar nome/ })).toBeVisible();
  await page.locator('.room-demo').getByRole('button', { name: 'Jogar', exact: true }).click();
  await expect(page.locator('.player-mat')).toHaveCount(4);
  await page.getByRole('button', { name: /sair da mesa/i }).click();
  await expect(page.getByRole('heading', { name: 'Jogos', exact: true })).toBeVisible();
});

for (const invalid of ['removed', 'invalid']) {
  test('returns to deck selection when saved deck is ' + invalid, async ({ page }) => {
    await seed(page, true);
    await page.evaluate(async invalid => {
      const { localRepository } = await import('/src/services/storage.ts');
      const id = await localRepository.getPreference<string>('selected-deck-id');
      if (invalid === 'removed') await localRepository.deleteDeck(id!);
      else { const deck = (await localRepository.getDecks()).find(deck => deck.id === id)!; deck.entries = []; await localRepository.saveDeck(deck); }
    }, invalid);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Escolha seu deck', exact: true })).toBeVisible();
    await expect(page.locator('.room-browser-shell, .entry-form')).toHaveCount(0);
  });
}

test('lists rooms, hides closed rooms and requests the password in context', async ({ page }) => {
  await seed(page); await mockOnline(page); await choose(page);
  await expect(page.locator('.room-directory-card')).toHaveCount(3);
  await expect(page.getByText('Mesa encerrada')).toHaveCount(0);
  await expect(page.locator('.room-create-form')).toHaveCount(0);
  await page.locator('.room-directory-card').filter({ hasText: 'Mesa com senha' }).getByRole('button').click();
  await expect(page.getByLabel('Código da mesa')).toHaveValue('LOCKROOM');
  await page.getByLabel('Senha, se houver').fill('wrong');
  await page.locator('form').getByRole('button', { name: 'Entrar na mesa', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Senha incorreta');
  await expect(page.locator('.room-demo')).toBeVisible();
});

test('auto applies deck and allows retry without enabling ready before success', async ({ page }) => {
  await seed(page); await mockOnline(page); await choose(page);
  await page.evaluate(() => { (window as any).onlineTest.failSave = true; });
  await page.locator('.room-directory-card').filter({ hasText: 'Mesa aberta' }).getByRole('button').click();
  await expect(page.getByRole('button', { name: /Confirmar meu lugar/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Tentar novamente', exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).onlineTest.failSave = false; });
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(page.getByRole('button', { name: /Confirmar meu lugar/ })).toBeEnabled();
  expect(await page.evaluate(() => (window as any).onlineTest.saves.length)).toBe(1);
  await page.getByRole('button', { name: /Sair da sala/ }).click();
  await expect(page.getByRole('heading', { name: 'Jogos', exact: true })).toBeVisible();
});

test('does not overwrite a running match deck', async ({ page }) => {
  await seed(page); await mockOnline(page, 'playing'); await choose(page);
  await page.locator('.room-directory-card').filter({ hasText: 'Mesa aberta' }).getByRole('button').click();
  await expect(page.locator('.player-mat')).toHaveCount(4);
  expect(await page.evaluate(() => (window as any).onlineTest.saves)).toEqual([]);
});

test('keeps an invite until name and deck are ready', async ({ page }) => {
  await page.addInitScript(() => { (window as any).meuMagicDesktop = { checkForUpdate: async () => null, onInvite: (callback: any) => { (window as any).deliverInvite = callback; return () => {}; }, onMcpToolCall: () => () => {}, onBeforeQuit: () => () => {}, onLegacyMigrationEvent: () => () => {}, acknowledgeLegacyMigrationEvent: () => {}, startLegacyMigration: async () => true }; });
  await seed(page); await mockOnline(page);
  await page.evaluate(() => (window as any).deliverInvite('LOCKROOM'));
  await expect(page.getByLabel('Seu nome', { exact: true })).toBeVisible();
  await choose(page);
  await expect(page.getByLabel('Código da mesa')).toHaveValue('LOCKROOM');
  expect(await page.evaluate(() => (window as any).onlineTest.attempts)).toEqual([]);
});

for (const width of [1440, 390]) {
  test('keeps the simplified flow within viewport at ' + width, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await seed(page);
    await page.screenshot({ path: testInfo.outputPath('name.png'), fullPage: true });
    await openLibrary(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('decks.png'), fullPage: true });
    await page.locator('.starter-card').first().getByRole('button', { name: /^Escolher / }).click();
    await expect(page.locator('.room-demo')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('games.png'), fullPage: true });
  });
}

test('keeps the demo usable when the directory fails and persists a changed deck', async ({ page }) => {
  await seed(page); await mockOnline(page);
  await page.evaluate(async () => {
    const runtime = performance.getEntriesByType('resource').map(entry => entry.name).find(url => url.includes('/src/services/roomBackend.ts'))!;
    const { roomBackend } = await import(runtime);
    roomBackend.connectIdentity = async () => { throw new Error('Diretório indisponível'); };
  });
  await choose(page);
  await expect(page.getByText('Diretório indisponível', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Trocar deck/ }).click();
  await page.getByRole('button', { name: 'Escolher Family Matters', exact: true }).click();
  await expect(page.getByRole('button', { name: /Family Matters · Trocar deck/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: /Family Matters · Trocar deck/ })).toBeVisible();
  await page.locator('.room-demo').getByRole('button', { name: 'Jogar', exact: true }).click();
  await expect(page.getByRole('button', { name: "Comandante: Zinnia, Valley's Voice", exact: true })).toBeVisible();
});

for (const role of ['returning', 'spectator']) {
  test('preserves the deck when joining as ' + role + ' before a match snapshot arrives', async ({ page }) => {
    await seed(page); await mockOnline(page);
    await page.evaluate(async role => {
      const runtime = performance.getEntriesByType('resource').map(entry => entry.name).find(url => url.includes('/src/services/roomBackend.ts'))!;
      const { roomBackend } = await import(runtime);
      const join = roomBackend.join.bind(roomBackend);
      roomBackend.join = async (...args: any[]) => {
        const joined = await join(...args);
        joined.member.ready = role === 'returning';
        if (role === 'spectator') { joined.member.seatId = null; joined.member.role = 'spectator'; (window as any).onlineTest.snapshot.selfSeatId = undefined; }
        return joined;
      };
    }, role);
    await choose(page);
    await page.locator('.room-directory-card').filter({ hasText: 'Mesa aberta' }).getByRole('button').click();
    await expect(page.locator('.lobby-shell')).toBeVisible();
    expect(await page.evaluate(() => (window as any).onlineTest.saves)).toEqual([]);
  });
}
