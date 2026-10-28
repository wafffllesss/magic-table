import { test, expect, type Page } from '@playwright/test';
import { preconFixtureDecks } from '../tests/fixtures/precons';
import { imageBytes } from './fixtures';
import { readFile } from 'node:fs/promises';

const databaseURL = 'http://127.0.0.1:9000';
// The Database emulator namespace follows the project ID.
const namespace = 'demo-magic-table';

test('joins three MCP agents as separate Firebase players and seats', async ({ browser, request }) => {
  const rules = await readFile(new URL('../database.rules.json', import.meta.url), 'utf8');
  expect((await request.put(`${databaseURL}/.settings/rules.json?ns=${namespace}`, {
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, data: rules,
  })).ok()).toBe(true);
  await request.delete(`${databaseURL}/.json?ns=${namespace}`, { headers: { Authorization: 'Bearer owner' } });
  await request.delete('http://127.0.0.1:9099/emulator/v1/projects/demo-magic-table/accounts');
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.route('https://cards.scryfall.io/**', route => route.fulfill({ contentType: 'image/png', body: imageBytes }));
    await page.goto('/');
    await page.evaluate(async deck => {
      const { localRepository } = await import('/src/services/storage.ts');
      deck.entries[0].card.card_faces = undefined;
      await localRepository.saveDeck(deck);
      await localRepository.setPreference('hide-table-tutorial', true);
    }, preconFixtureDecks()[0]);
    await page.reload();
    await page.getByLabel('Seu nome', { exact: true }).fill('Ana');
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await page.getByRole('button', { name: 'Escolher ' + preconFixtureDecks()[0].name, exact: true }).click();
    await page.getByRole('button', { name: 'Criar mesa', exact: true }).click();
    await page.getByRole('button', { name: 'Criar mesa e entrar', exact: true }).click();
    await expect(page.getByRole('button', { name: /Confirmar meu lugar/ })).toBeEnabled();
    const listing = await request.get(`${databaseURL}/p2pDirectory.json?ns=${namespace}`, { headers: { Authorization: 'Bearer owner' } });
    const rooms = await listing.json();
    const roomId = Object.keys(rooms)[0];
    const code = rooms[roomId].code;
    const joined = await page.evaluate(async roomCode => {
      const { mcpAgents } = await import('/src/services/mcpAgents.ts');
      return Promise.all(['Botia um', 'Botia dois', 'Botia três'].map((name, index) => mcpAgents.invoke('join_room', {
        code: roomCode, name, requestId: `join-agent-${index + 1}`,
      })));
    }, code);
    expect(joined.map((agent: any) => agent.seatId)).toHaveLength(3);
    expect(new Set(joined.map((agent: any) => agent.seatId)).size).toBe(3);
    const membersResponse = await request.get(`${databaseURL}/p2pRooms/${roomId}/members.json?ns=${namespace}`, { headers: { Authorization: 'Bearer owner' } });
    const agents = Object.values(await membersResponse.json()).filter((member: any) => member.agent === true) as Array<{ uid: string; seatId: string }>;
    expect(agents).toHaveLength(3);
    expect(new Set(agents.map(agent => agent.uid)).size).toBe(3);
    expect(new Set(agents.map(agent => agent.seatId)).size).toBe(3);
  } finally {
    await page.evaluate(async () => {
      const { mcpAgents } = await import('/src/services/mcpAgents.ts');
      await mcpAgents.closeAll();
    }).catch(() => {});
    await context.close();
  }
});

test('synchronizes four players, protects hidden zones and restores the same player after reload', async ({ browser, request }) => {
  const rules = await readFile(new URL('../database.rules.json', import.meta.url), 'utf8');
  expect((await request.put(`${databaseURL}/.settings/rules.json?ns=${namespace}`, {
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, data: rules,
  })).ok()).toBe(true);
  await request.delete(`${databaseURL}/.json?ns=${namespace}`, { headers: { Authorization: 'Bearer owner' } });
  await request.delete('http://127.0.0.1:9099/emulator/v1/projects/demo-magic-table/accounts');
  const contexts = await Promise.all(Array.from({ length: 4 }, () => browser.newContext()));
  const pages: Page[] = [];
  const errors: string[] = [];
  const names = ['Ana', 'Bruno', 'Clara', 'Davi'];
  let roomCode = '';
  let roomId = '';
  try {
    for (const [index, context] of contexts.entries()) {
      const page = await context.newPage(); pages.push(page);
      page.on('pageerror', error => errors.push(error.message));
      await page.route('https://cards.scryfall.io/**', route => route.fulfill({ contentType: 'image/png', body: imageBytes }));
      await page.goto('/');
      await page.evaluate(async deck => {
        const { localRepository } = await import('/src/services/storage.ts');
        // Include the optional undefined values present in normalized Scryfall metadata.
        deck.entries[0].card.card_faces = undefined;
        await localRepository.saveDeck(deck);
        await localRepository.setPreference('hide-table-tutorial', true);
      }, preconFixtureDecks()[index]);
      await page.reload();
      await page.getByLabel('Seu nome', { exact: true }).fill(names[index]);
      await page.getByRole('button', { name: 'Continuar', exact: true }).click();
      await page.getByRole('button', { name: 'Escolher ' + preconFixtureDecks()[index].name, exact: true }).click();
      if (index === 0) {
        await page.getByRole('button', { name: 'Criar mesa', exact: true }).click();
        await page.getByRole('button', { name: 'Criar mesa e entrar', exact: true }).click();
        await expect(page.getByRole('button', { name: /Confirmar meu lugar/ })).toBeEnabled();
        const listing = await request.get(databaseURL + '/p2pDirectory.json?ns=' + namespace, { headers: { Authorization: 'Bearer owner' } });
        const rooms = await listing.json();
        roomId = Object.keys(rooms)[0]; roomCode = rooms[roomId].code;
      } else {
        await page.getByRole('button', { name: 'Entrar com código', exact: true }).click();
        await page.getByLabel('Código da mesa').fill(roomCode);
        await page.locator('form').getByRole('button', { name: 'Entrar na mesa', exact: true }).click();
      }
      await expect(page.getByRole('button', { name: /Confirmar meu lugar/ })).toBeEnabled();
    }
    await expect(pages[1].getByRole('status').filter({ hasText: /Conectado com Ana/ })).toBeVisible();
    await expect(pages[0].getByRole('status').filter({ hasText: /Conectado com Bruno/ })).toBeVisible();
    await expect(pages[1].getByRole('status').filter({ hasText: /Conectado com Ana/ })).toContainText(/\((Direta|Relay TURN|Relay Firebase)\)/);
    await pages[1].screenshot({ path: 'test-results/lobby-connection-desktop.png' });
    await pages[1].setViewportSize({ width: 390, height: 844 });
    await expect(pages[1].getByRole('status').filter({ hasText: /Conectado com Ana/ })).toBeVisible();
    await pages[1].screenshot({ path: 'test-results/lobby-connection-mobile.png' });
    await pages[1].setViewportSize({ width: 1280, height: 720 });
    // Exercise the Firebase fallback in both directions even when WebRTC is available.
    const ids = await Promise.all(pages.slice(0, 2).map(page => page.evaluate(async () => {
      const { roomBackend } = await import('/src/services/roomBackend.ts');
      return roomBackend.uid!;
    })));
    for (const [index, page] of pages.slice(0, 2).entries()) {
      await page.evaluate(async ({ roomId, peer }) => {
        const { roomBackend } = await import('/src/services/roomBackend.ts');
        const bus = roomBackend.createDataBus(roomId);
        const received: { packets: string[]; presences: unknown[] } = { packets: [], presences: [] };
        (window as any).relayTest = received;
        bus.subscribe(peer, 1, '00000000-0000-4000-8000-000000000001', (_sequence, packet) => { received.packets.push(packet); });
        bus.subscribePresence(peer, 1, '00000000-0000-4000-8000-000000000001', payload => { received.presences.push(payload); });
      }, { roomId, peer: ids[1 - index] });
    }
    for (const [index, page] of pages.slice(0, 2).entries()) {
      await page.evaluate(async ({ roomId, peer, index }) => {
        const { roomBackend } = await import('/src/services/roomBackend.ts');
        const bus = roomBackend.createDataBus(roomId);
        await bus.send(peer, 1, '00000000-0000-4000-8000-000000000001', 0, `packet-${index}`);
        await bus.sendPresence(peer, 1, '00000000-0000-4000-8000-000000000001', { sequence: index, pose: 'rest', zone: 'table', updatedAt: Date.now() });
      }, { roomId, peer: ids[1 - index], index });
    }
    for (const [index, page] of pages.slice(0, 2).entries()) {
      await expect.poll(() => page.evaluate(() => (window as any).relayTest)).toMatchObject({
        packets: [`packet-${1 - index}`], presences: [{ sequence: 1 - index }],
      });
    }
    for (const page of pages) await page.getByRole('button', { name: /Confirmar meu lugar/ }).click();
    for (const page of pages) {
      await expect(page.locator('.player-mat')).toHaveCount(4);
      await expect(page.locator('.fan-card')).toHaveCount(7);
    }
    for (const page of pages) {
      await page.getByRole('button', { name: 'Manter mão', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Manter mão', exact: true })).toHaveCount(0);
    }
    await pages[0].getByRole('button', { name: 'Aumentar vida de Ana', exact: true }).click();
    for (const page of pages) await expect(page.getByRole('region', { name: 'Vida de Ana', exact: true }).locator('strong')).toHaveText('41');

    await pages[0].keyboard.press('Control+d');
    await expect(pages[0].locator('.fan-card')).toHaveCount(8);
    await expect(pages[0].locator('.shared-card-inspection')).toBeVisible();
    await pages[0].keyboard.press('Escape');
    await expect(pages[0].locator('.shared-card-inspection')).toHaveCount(0);
    for (const page of pages.slice(1)) {
      await expect(page.getByRole('img', { name: 'Mão de Ana: 8 cartas', exact: true })).toBeAttached();
      await expect(page.locator('.fan-card')).toHaveCount(7);
    }
    await expect(pages[0].locator('.deck-action').first()).toBeEnabled();
    await pages[0].keyboard.press('Control+z');
    await expect(pages[0].locator('.fan-card')).toHaveCount(7);
    for (const page of pages.slice(1)) await expect(page.getByRole('img', { name: 'Mão de Ana: 7 cartas', exact: true })).toBeAttached();
    await pages[0].keyboard.press('Control+y');
    await expect(pages[0].locator('.fan-card')).toHaveCount(8);
    for (const page of pages.slice(1)) await expect(page.getByRole('img', { name: 'Mão de Ana: 8 cartas', exact: true })).toBeAttached();
    for (const page of pages) expect(await page.evaluate(async () => {
      const { peerRoom } = await import('/src/services/peerRoom.ts');
      const room = peerRoom as any;
      return Object.values(room.localState.cards).filter((card: any) =>
        card.ownerId !== room.member.seatId && ['hand', 'library'].includes(card.zone)).length;
    })).toBe(0);
    expect(await pages[1].evaluate(async () => {
      const { getApps } = await import('/node_modules/.vite/deps/firebase_app.js');
      const { get, getDatabase, ref } = await import('/node_modules/.vite/deps/firebase_database.js');
      try { await get(ref(getDatabase(getApps().find(app => app.name === 'meu-magic-p2p')), 'rooms/main/privateSeats/northWest')); return false; }
      catch { return true; }
    })).toBe(true);
    const before = await request.get(`${databaseURL}/p2pRooms/${roomId}/members.json?ns=${namespace}`, { headers: { Authorization: 'Bearer owner' } });
    const uid = Object.keys(await before.json()).sort();
    await pages[0].reload();
    await pages[0].getByRole('button', { name: 'Entrar com código', exact: true }).click();
    await pages[0].getByLabel('Código da mesa').fill(roomCode);
    await pages[0].locator('form').getByRole('button', { name: 'Entrar na mesa', exact: true }).click();
    await expect(pages[0].locator('.mat-northWest')).toHaveClass(/is-self/);
    await expect(pages[0].locator('.fan-card')).toHaveCount(8);
    await expect(pages[0].getByRole('region', { name: 'Vida de Ana', exact: true }).locator('strong')).toHaveText('41');
    const after = await request.get(`${databaseURL}/p2pRooms/${roomId}/members.json?ns=${namespace}`, { headers: { Authorization: 'Bearer owner' } });
    expect(Object.keys(await after.json()).sort()).toEqual(uid);
    for (const page of pages.slice(1)) await expect(page.getByRole('img', { name: 'Mão de Ana: 8 cartas', exact: true })).toBeAttached();
    for (const [index, page] of pages.entries()) await expect.poll(() => page.evaluate(async () => {
      const { peerRoom } = await import('/src/services/peerRoom.ts');
      return (peerRoom as any).snapshot.connectionState;
    }), { timeout: 60_000, message: `Player ${index + 1} should reconnect` }).toBe('connected');
    await pages[1].getByRole('button', { name: 'Aumentar vida de Bruno', exact: true }).click();
    for (const page of pages) await expect(page.getByRole('region', { name: 'Vida de Bruno', exact: true }).locator('strong')).toHaveText('41');
    expect(errors).toEqual([]);
  } catch (error) {
    const diagnostics = await Promise.all(pages.map(page => page.evaluate(async () => {
      const { peerRoom } = await import('/src/services/peerRoom.ts');
      const room = peerRoom as any;
      return { text: document.body.innerText, snapshot: { ...room.snapshot, state: undefined },
        peers: [...(room.transport?.peers ?? [])].map(([uid, link]: any) => ({ uid, connection: link.pc.connectionState,
          signaling: link.pc.signalingState, reliable: link.reliable?.readyState, remote: link.remoteReady })),
      };
    }).catch(() => ({ closed: true }))));
    await test.info().attach('room-diagnostics', { body: JSON.stringify(diagnostics, null, 2), contentType: 'application/json' });
    throw error;
  } finally { await Promise.all(contexts.map(context => context.close())); }
});

test('creates password rooms and rejects a wrong password before joining', async ({ browser, request }) => {
  const rules = await readFile(new URL('../database.rules.json', import.meta.url), 'utf8');
  expect((await request.put(`${databaseURL}/.settings/rules.json?ns=${namespace}`, {
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, data: rules,
  })).ok()).toBe(true);
  await request.delete(`${databaseURL}/.json?ns=${namespace}`, { headers: { Authorization: 'Bearer owner' } });
  await request.delete('http://127.0.0.1:9099/emulator/v1/projects/demo-magic-table/accounts');
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const pages: Page[] = [];
  try {
    for (const [index, context] of contexts.entries()) {
      const page = await context.newPage(); pages.push(page);
      await page.route('https://cards.scryfall.io/**', route => route.fulfill({ contentType: 'image/png', body: imageBytes }));
      await page.goto('/');
      await page.evaluate(async deck => {
        const { localRepository } = await import('/src/services/storage.ts');
        deck.entries[0].card.card_faces = undefined;
        await localRepository.saveDeck(deck);
      }, preconFixtureDecks()[index]);
      await page.reload();
      await page.getByLabel('Seu nome', { exact: true }).fill(index === 0 ? 'Ana' : 'Bia');
      await page.getByRole('button', { name: 'Continuar', exact: true }).click();
      await page.getByRole('button', { name: 'Escolher ' + preconFixtureDecks()[index].name, exact: true }).click();
      if (index === 0) {
        await page.getByRole('button', { name: 'Criar mesa', exact: true }).click();
        await page.getByLabel('Senha (opcional)').fill('mesa-secreta');
        await page.getByRole('button', { name: 'Criar mesa e entrar', exact: true }).click();
        await expect(page.getByRole('button', { name: /Confirmar meu lugar/ })).toBeEnabled();
        const listing = await request.get(`${databaseURL}/p2pDirectory.json?ns=${namespace}`, { headers: { Authorization: 'Bearer owner' } });
        const rooms = await listing.json();
        (page as Page & { roomCode?: string }).roomCode = Object.values(rooms)[0].code;
      } else {
        const roomCode = (pages[0] as Page & { roomCode?: string }).roomCode!;
        await page.getByRole('button', { name: 'Entrar com código', exact: true }).click();
        await page.getByLabel('Código da mesa').fill(roomCode);
        await page.getByLabel('Senha, se houver').fill('senha-errada');
        await page.locator('form').getByRole('button', { name: 'Entrar na mesa', exact: true }).click();
        await expect(page.locator('.room-browser-error')).toHaveText('Senha incorreta. Confira o código e tente novamente.');
        await page.getByLabel('Senha, se houver').fill('mesa-secreta');
        await page.locator('form').getByRole('button', { name: 'Entrar na mesa', exact: true }).click();
        await expect(page.getByRole('button', { name: /Confirmar meu lugar/ })).toBeEnabled();
      }
    }
  } finally { await Promise.all(contexts.map(context => context.close())); }
});
