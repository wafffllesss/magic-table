import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalRepository, MAX_SINGLE_IMAGE_BYTES } from './storage';
import { commanders, fixtureDecks } from '../../tests/fixtures/scryfall';

const repositories: LocalRepository[] = [];
function repository(name = crypto.randomUUID(), limit?: number): LocalRepository {
  const repo = new LocalRepository(name, limit); repositories.push(repo); return repo;
}
afterEach(async () => { await Promise.all(repositories.splice(0).map(repo => repo.close())); vi.unstubAllGlobals(); });

describe('persistent card repository', () => {
  it('does not revive outdated metadata and aliases from a legacy deck after refresh', async () => {
    const repo = repository(), deck = fixtureDecks()[0];
    await repo.saveDeck(deck);
    const card = deck.entries[0].card!;
    await repo.putCard({ ...card, name: 'Refreshed name' });
    const reads = vi.spyOn(repo, 'getDecks');
    const result = await repo.getCardsByNames([card.name, 'Refreshed name']);
    expect(reads).toHaveBeenCalledOnce();
    expect(result.has(card.name.toLocaleLowerCase('en-US'))).toBe(false);
    expect(result.get('refreshed name')?.id).toBe(card.id);
    expect((await repo.getCard(card.id))?.name).toBe('Refreshed name');
  });

  it('reads legacy decks once for a batch and reuses normalized names and faces', async () => {
    const repo = repository();
    const deck = fixtureDecks()[0];
    await repo.saveDeck(deck);
    const reads = vi.spyOn(repo, 'getDecks');
    const names = deck.entries.map(entry => entry.name).concat(['Missing card', 'Another missing card']);
    const result = await repo.getCardsByNames(names);
    expect(reads).toHaveBeenCalledTimes(1);
    expect(result.get(deck.entries[0].name.toLocaleLowerCase('en-US'))?.id).toBe(deck.entries[0].cardId);
    expect(result.has('missing card')).toBe(false);
    reads.mockClear();
    expect(await repo.getCardsByNames(deck.entries.map(entry => entry.name))).toEqual(
      new Map(deck.entries.map(entry => [entry.name.toLocaleLowerCase('en-US'), entry.card])));
    expect(reads).not.toHaveBeenCalled();
  });

  it('stores a checkpoint isolated from caller changes and returns the persisted copy', async () => {
    const repo = repository();
    const { startDemoMatch } = await import('./demo');
    const state = startDemoMatch('Lia', fixtureDecks());
    const saved = await repo.saveRoomSession({ roomId: 'room', uid: 'uid', matchId: state.id, revision: state.revision, publicState: state, privateState: { hand: ['private'] } });
    state.seats[0].life = 1;
    expect(saved.publicState.seats[0].life).not.toBe(1);
    expect((await repo.getRoomSession('room', 'uid'))!.publicState).toEqual(saved.publicState);
  });
  it('migrates version 2 metadata once and avoids scanning or rewriting image blobs on cache operations', async () => {
    const name = crypto.randomUUID();
    const db = await openDB(name, 2, { upgrade(database) {
      database.createObjectStore('preferences', { keyPath: 'key' });
      database.createObjectStore('decks', { keyPath: 'id' });
      const cards = database.createObjectStore('cards', { keyPath: 'card.id' });
      cards.createIndex('by-access', 'accessedAt'); cards.createIndex('by-name', 'names', { multiEntry: true });
      database.createObjectStore('images', { keyPath: 'id' }).createIndex('by-access', 'accessedAt');
    } });
    await db.put('images', { id: 'old', blob: new Blob(['old']), size: 3, cachedAt: 1, accessedAt: 1 });
    db.close();
    const repo = repository(name);
    expect(await repo.cacheUsage()).toBe(3);
    const scan = vi.spyOn(IDBObjectStore.prototype, 'getAll');
    const writes = vi.spyOn(IDBObjectStore.prototype, 'put');
    await repo.getImage('old');
    expect(writes.mock.instances.filter(store => (store as IDBObjectStore).name === 'images')).toHaveLength(0);
    await Promise.all([
      repo.putImage('old', new Blob(['replacement'], { type: 'image/jpeg' })),
      repo.putImage('new', new Blob(['extra'], { type: 'image/jpeg' })),
    ]);
    expect(await repo.cacheUsage()).toBe(16);
    expect(scan).not.toHaveBeenCalled();
    await repo.close();
    expect(await repository(name).cacheUsage()).toBe(16);
  });
  it('upgrades version 1 without losing decks, images, preferences or card timestamps', async () => {
    const name = crypto.randomUUID();
    const db = await openDB(name, 1, { upgrade(database) {
      database.createObjectStore('preferences', { keyPath: 'key' });
      database.createObjectStore('decks', { keyPath: 'id' });
      database.createObjectStore('cards', { keyPath: 'card.id' }).createIndex('by-access', 'accessedAt');
      database.createObjectStore('images', { keyPath: 'id' }).createIndex('by-access', 'accessedAt');
    } });
    const card = { ...commanders[0], name: 'Front // Back', card_faces: [{ name: 'Front', mana_cost: '', type_line: 'Creature', oracle_text: '' }, { name: 'Back', mana_cost: '', type_line: 'Creature', oracle_text: '' }] };
    await db.put('cards', { card, cachedAt: 123, accessedAt: 123 });
    await db.put('decks', fixtureDecks()[0]);
    await db.put('preferences', { key: 'player-name', value: 'Lia' });
    await db.put('images', { id: 'legacy-image', blob: new Blob(['image'], { type: 'image/jpeg' }), size: 5, accessedAt: 123, cachedAt: 123 });
    await db.put('images', { id: `${card.id}-0-small`, blob: new Blob(['cached art'], { type: 'image/jpeg' }), size: 10, accessedAt: 123, cachedAt: 123 });
    await db.put('images', { id: `${card.id}-0-normal`, blob: new Blob(['outdated art'], { type: 'image/jpeg' }), size: 12, accessedAt: 122, cachedAt: 122 });
    db.close();
    const repo = repository(name);
    expect((await repo.getCardByName('  BACK '))?.id).toBe(card.id);
    expect((await repo.getCachedCard(card.id))?.cachedAt).toBe(123);
    expect((await repo.getCardByName('FRONT // BACK'))?.id).toBe(card.id);
    expect(await repo.getPreference('player-name')).toBe('Lia');
    expect(await repo.getDecks()).toHaveLength(1);
    expect(await (await repo.getImage('legacy-image'))?.text()).toBe('image');
    expect(await (await repo.getImage(JSON.stringify([card.id, 0, 'small', card.image_uris!.small])))?.text()).toBe('cached art');
    expect(await repo.getImage(JSON.stringify([card.id, 0, 'normal', card.image_uris!.normal]))).toBeUndefined();
    await repo.close();
    const nextSession = repository(name);
    expect((await nextSession.getCardByName('front'))?.id).toBe(card.id);
    expect(await nextSession.getDecks()).toHaveLength(1);
  });

  it('indexes normalized names and faces and updates aliases after manual refresh', async () => {
    const repo = repository();
    await repo.putCard({ ...commanders[4], printed_name: 'Lae’zel' });
    expect((await repo.getCardByName(" LAE'ZEL "))?.id).toBe(commanders[4].id);
    await repo.putCard({ ...commanders[4], name: 'Updated name' });
    expect(await repo.getCardByName("Lae'zel")).toBeUndefined();
    expect((await repo.getCardByName('Updated name'))?.id).toBe(commanders[4].id);
  });

  it('evicts least recently accessed cache entries without deleting decks or preferences', async () => {
    const repo = repository(undefined, 125);
    await repo.saveDeck(fixtureDecks()[0]);
    await repo.setPreference('player-name', 'Lia');
    const time = vi.spyOn(Date, 'now');
    time.mockReturnValue(1); await repo.putImage('first', new Blob(['x'.repeat(60)], { type: 'image/jpeg' }));
    time.mockReturnValue(2); await repo.putImage('second', new Blob(['x'.repeat(60)], { type: 'image/jpeg' }));
    time.mockReturnValue(3); await repo.getImage('first');
    time.mockReturnValue(4); await repo.putImage('third', new Blob(['x'.repeat(60)], { type: 'image/jpeg' }));
    expect(await repo.getImage('second')).toBeUndefined();
    expect(await repo.getImage('first')).toBeDefined();
    expect(await repo.cacheUsage()).toBe(120);
    expect(await repo.getDecks()).toHaveLength(1);
    expect(await repo.getPreference('player-name')).toBe('Lia');
    expect(await repo.putImage('invalid', new Blob(['text']))).toBe(false);
    expect(await repo.putImage('oversized', new Blob([new Uint8Array(MAX_SINGLE_IMAGE_BYTES + 1)], { type: 'image/jpeg' }))).toBe(false);
    await repo.putCard(commanders[0]);
    expect(await repo.getCard(commanders[0].id)).toBeUndefined();
    expect(await repo.cacheUsage()).toBeLessThanOrEqual(125);
  });

  it('falls back to memory and announces the loss of persistence once', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const repo = repository(); const warning = vi.fn();
    repo.addEventListener('persistence-unavailable', warning);
    await repo.putCards([commanders[0]]);
    await repo.saveDeck(fixtureDecks()[0]);
    await repo.setPreference('player-name', 'Lia');
    await repo.putImage('image', new Blob(['image'], { type: 'image/jpeg' }));
    expect(await repo.getCardByName(commanders[0].name)).toEqual(commanders[0]);
    expect(await repo.getImage('image')).toBeDefined();
    expect(await repo.getDecks()).toHaveLength(1);
    expect(await repo.getPreference('player-name')).toBe('Lia');
    expect(repo.persistenceAvailable).toBe(false);
    expect(warning).toHaveBeenCalledOnce();
  });
});
