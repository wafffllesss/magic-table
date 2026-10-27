import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { CardDefinition, DeckDefinition } from '../domain/game';
import type { MatchState } from '../domain/game';
import { cardNames, normaliseCardName } from '../domain/cardNames';

export type CachedCard = { card: CardDefinition; names?: string[]; cachedAt: number; accessedAt: number; size?: number };
export type CachedImage = { id: string; blob: Blob; cachedAt: number; accessedAt: number; size: number };
type CacheEntry = { key: string; store: 'cards' | 'images'; id: string; size: number; accessedAt: number };
export type SavedRoomSession = { key: string; roomId: string; uid: string; matchId: string; revision: number; publicState: MatchState; privateState: unknown; pending?: { actionId: string; revision: number; publicState: MatchState; privateState?: unknown }; updatedAt: number };
const CACHE_BYTES_KEY = 'cache-bytes';
const cacheKey = (store: CacheEntry['store'], id: string) => JSON.stringify([store, id]);

interface MeuMagicDB extends DBSchema {
  decks: { key: string; value: DeckDefinition };
  cards: { key: string; value: CachedCard; indexes: { 'by-access': number; 'by-name': string } };
  images: { key: string; value: CachedImage; indexes: { 'by-access': number } };
  preferences: { key: string; value: { key: string; value: unknown } };
  cacheEntries: { key: string; value: CacheEntry; indexes: { 'by-access': number } };
  roomSessions: { key: string; value: SavedRoomSession; indexes: { 'by-updated': number } };
}

export const MAX_CARD_CACHE_BYTES = 200 * 1024 * 1024;
export const MAX_SINGLE_IMAGE_BYTES = 3 * 1024 * 1024;

export class LocalRepository extends EventTarget {
  private database?: Promise<IDBPDatabase<MeuMagicDB>>;
  private cardsFallback = new Map<string, CachedCard>();
  private imagesFallback = new Map<string, CachedImage>();
  private decksFallback = new Map<string, DeckDefinition>();
  private preferencesFallback = new Map<string, unknown>();
  private roomSessionsFallback = new Map<string, SavedRoomSession>();
  persistenceAvailable = true;

  constructor(private readonly name = 'meu-magic', private readonly cacheLimit = MAX_CARD_CACHE_BYTES) { super(); }

  private persistenceFailed(): void {
    if (!this.persistenceAvailable) return;
    this.persistenceAvailable = false;
    this.dispatchEvent(new Event('persistence-unavailable'));
  }

  async close(): Promise<void> { if (this.database) (await this.database.catch(() => undefined))?.close(); this.database = undefined; }

  private getDB(): Promise<IDBPDatabase<MeuMagicDB>> {
    if (!this.database) {
      this.database = openDB<MeuMagicDB>(this.name, 4, {
        async upgrade(database, oldVersion, _newVersion, transaction) {
          if (oldVersion < 1) {
            database.createObjectStore('preferences', { keyPath: 'key' });
            database.createObjectStore('decks', { keyPath: 'id' });
            const cards = database.createObjectStore('cards', { keyPath: 'card.id' });
            cards.createIndex('by-access', 'accessedAt');
            const images = database.createObjectStore('images', { keyPath: 'id' });
            images.createIndex('by-access', 'accessedAt');
          }
          const cards = transaction.objectStore('cards');
          if (oldVersion < 2) {
            cards.createIndex('by-name', 'names', { multiEntry: true });
            let cursor = await cards.openCursor();
            while (cursor) {
              await cursor.update({ ...cursor.value, names: cardNames(cursor.value.card) });
              cursor = await cursor.continue();
            }
            const images = transaction.objectStore('images');
            let image = await images.openCursor();
            while (image) {
              const legacy = image.value.id.match(/^(.+)-(\d+)-(small|normal)$/);
              if (legacy) {
                const record = await cards.get(legacy[1]);
                const face = Number(legacy[2]); const size = legacy[3];
                const uri = record?.card.image_uris?.[size] ?? record?.card.card_faces?.[face]?.image_uris?.[size];
                // A later metadata refresh may have changed the URL; only migrate a known source.
                if (uri && record && image.value.cachedAt >= record.cachedAt) {
                  await images.put({ ...image.value, id: JSON.stringify([record.card.id, face, size, uri]) });
                  await image.delete();
                }
              }
              image = await image.continue();
            }
          }
          if (oldVersion < 3) {
            const metadata = database.createObjectStore('cacheEntries', { keyPath: 'key' });
            metadata.createIndex('by-access', 'accessedAt');
            let total = 0;
            let cardCursor = await cards.openCursor();
            while (cardCursor) {
              const record = cardCursor.value;
              const size = record.size ?? encodedSize(record.card);
              await metadata.put({ key: cacheKey('cards', record.card.id), store: 'cards', id: record.card.id, size, accessedAt: record.accessedAt });
              total += size; cardCursor = await cardCursor.continue();
            }
            let imageCursor = await transaction.objectStore('images').openCursor();
            while (imageCursor) {
              const record = imageCursor.value;
              await metadata.put({ key: cacheKey('images', record.id), store: 'images', id: record.id, size: record.size, accessedAt: record.accessedAt });
              total += record.size; imageCursor = await imageCursor.continue();
            }
            await transaction.objectStore('preferences').put({ key: CACHE_BYTES_KEY, value: total });
            await transaction.objectStore('preferences').put({ key: 'cache-version', value: 3 });
          }
          if (oldVersion < 4) {
            database.createObjectStore('roomSessions', { keyPath: 'key' }).createIndex('by-updated', 'updatedAt');
          }
        },
      });
    }
    return this.database;
  }

  async getCard(id: string): Promise<CardDefinition | undefined> {
    return (await this.getCachedCard(id))?.card;
  }

  async getCachedCard(id: string): Promise<CachedCard | undefined> {
    const fallback = this.cardsFallback.get(id);
    if (fallback) { fallback.accessedAt = Date.now(); return fallback; }
    try {
      const database = await this.getDB();
      const cached = await database.get('cards', id);
      if (!cached) return undefined;
      cached.accessedAt = Date.now();
      try { await this.touchCache(database, 'cards', id, cached.accessedAt); } catch { this.persistenceFailed(); }
      return cached;
    } catch {
      this.persistenceFailed();
      const cached = this.cardsFallback.get(id);
      if (cached) cached.accessedAt = Date.now();
      return cached;
    }
  }

  async putCard(card: CardDefinition): Promise<void> {
    const record = { card: plain(card), names: cardNames(card), cachedAt: Date.now(), accessedAt: Date.now(), size: encodedSize(card) };
    try {
      const database = await this.getDB();
      await this.writeCache(database, 'cards', [record]);
      this.cardsFallback.delete(card.id);
    } catch {
      this.persistenceFailed();
      this.cardsFallback.set(card.id, record);
      this.enforceFallbackCacheLimit();
    }
  }

  async putCards(cards: CardDefinition[]): Promise<void> {
    if (!cards.length) return;
    const records = cards.map(card => ({ card: plain(card), names: cardNames(card), cachedAt: Date.now(), accessedAt: Date.now(), size: encodedSize(card) }));
    try {
      const database = await this.getDB();
      await this.writeCache(database, 'cards', records);
      cards.forEach(card => this.cardsFallback.delete(card.id));
    } catch {
      this.persistenceFailed();
      records.forEach(record => this.cardsFallback.set(record.card.id, record));
      this.enforceFallbackCacheLimit();
    }
  }

  async getCardByName(name: string): Promise<CardDefinition | undefined> {
    return (await this.getCardsByNames([name])).get(normaliseCardName(name));
  }

  async getCardsByNames(names: string[]): Promise<Map<string, CardDefinition>> {
    const keys = [...new Set(names.map(normaliseCardName))];
    const result = new Map<string, CardDefinition>();
    if (!keys.length) return result;
    const wanted = new Set(keys);
    for (const record of this.cardsFallback.values()) {
      for (const key of record.names ?? cardNames(record.card)) {
        if (wanted.has(key) && !result.has(key)) { result.set(key, record.card); record.accessedAt = Date.now(); }
      }
    }
    try {
      const database = await this.getDB();
      const transaction = database.transaction('cards');
      const missing = keys.filter(key => !result.has(key));
      const records = await Promise.all(missing.map(key => transaction.store.index('by-name').get(key)));
      await transaction.done;
      records.forEach((record, index) => {
        if (!record) return;
        const card = this.cardsFallback.get(record.card.id)?.card ?? record.card;
        if (cardNames(card).includes(missing[index])) result.set(missing[index], card);
      });
      const accessed = [...new Set(records.flatMap(record => record ? [record.card.id] : []))];
      if (accessed.length) {
        const touch = database.transaction('cacheEntries', 'readwrite');
        for (const id of accessed) {
          const key = cacheKey('cards', id);
          const entry = await touch.store.get(key);
          if (entry) await touch.store.put({ ...entry, accessedAt: Date.now() });
        }
        await touch.done;
      }
    } catch { this.persistenceFailed(); }
    // Decks saved before the card index was introduced also seed the cache on demand.
    if (result.size < keys.length) {
      const candidates = new Map<string, CardDefinition>();
      for (const deck of await this.getDecks()) for (const entry of deck.entries) {
        if (entry.card && cardNames(entry.card).some(key => wanted.has(key) && !result.has(key))) candidates.set(entry.card.id, entry.card);
      }
      const indexed = new Map<string, CardDefinition>();
      if (candidates.size) try {
        const transaction = (await this.getDB()).transaction('cards');
        const records = await Promise.all([...candidates.keys()].map(id => transaction.store.get(id)));
        await transaction.done;
        for (const record of records) if (record) indexed.set(record.card.id, record.card);
      } catch { this.persistenceFailed(); }
      const seeds = new Map<string, CardDefinition>();
      for (const [id, legacy] of candidates) {
        // A legacy deck must not overwrite metadata or aliases from a manual refresh.
        const card = this.cardsFallback.get(id)?.card ?? indexed.get(id) ?? legacy;
        for (const key of cardNames(card)) if (wanted.has(key) && !result.has(key)) {
          result.set(key, card);
          if (card === legacy) seeds.set(id, card);
        }
      }
      if (seeds.size) await this.putCards([...seeds.values()]);
    }
    return result;
  }

  async getDecks(): Promise<DeckDefinition[]> {
    try { return [...new Map([...(await (await this.getDB()).getAll('decks')), ...this.decksFallback.values()].map(deck => [deck.id, deck])).values()]; }
    catch { this.persistenceFailed(); return [...this.decksFallback.values()]; }
  }

  async saveRoomSession(session: Omit<SavedRoomSession, 'key' | 'updatedAt'>): Promise<SavedRoomSession> {
    const record: SavedRoomSession = { ...plain(session), key: `${session.roomId}:${session.uid}`, updatedAt: Date.now() };
    try { await (await this.getDB()).put('roomSessions', record); this.roomSessionsFallback.set(record.key, record); }
    catch { this.persistenceFailed(); this.roomSessionsFallback.set(record.key, record); }
    return record;
  }

  async getRoomSession(roomId: string, uid: string): Promise<SavedRoomSession | undefined> {
    const key = `${roomId}:${uid}`;
    try { return (await (await this.getDB()).get('roomSessions', key)) ?? this.roomSessionsFallback.get(key); }
    catch { this.persistenceFailed(); return this.roomSessionsFallback.get(key); }
  }

  async deleteRoomSession(roomId: string, uid: string): Promise<void> {
    const key = `${roomId}:${uid}`;
    this.roomSessionsFallback.delete(key);
    try { await (await this.getDB()).delete('roomSessions', key); }
    catch { this.persistenceFailed(); }
  }

  async saveDeck(deck: DeckDefinition): Promise<void> {
    const copy = plain(deck);
    try { await (await this.getDB()).put('decks', copy); this.decksFallback.delete(deck.id); }
    catch { this.persistenceFailed(); this.decksFallback.set(deck.id, copy); }
  }

  async deleteDeck(id: string): Promise<void> {
    this.decksFallback.delete(id);
    try { await (await this.getDB()).delete('decks', id); }
    catch { this.persistenceFailed(); }
  }

  async getImage(id: string): Promise<Blob | undefined> {
    const fallback = this.imagesFallback.get(id);
    if (fallback) { fallback.accessedAt = Date.now(); return fallback.blob; }
    try {
      const database = await this.getDB(); const cached = await database.get('images', id);
      if (!cached) return undefined;
      cached.accessedAt = Date.now();
      try { await this.touchCache(database, 'images', id, cached.accessedAt); } catch { this.persistenceFailed(); }
      return cached.blob;
    } catch { this.persistenceFailed(); return undefined; }
  }

  async putImage(id: string, blob: Blob): Promise<boolean> {
    if (!blob.size || blob.size > MAX_SINGLE_IMAGE_BYTES || !/^image\/(jpeg|png|webp)$/.test(blob.type)) return false;
    const record: CachedImage = { id, blob, size: blob.size, cachedAt: Date.now(), accessedAt: Date.now() };
    try {
      const database = await this.getDB();
      await this.writeCache(database, 'images', [record]);
      this.imagesFallback.delete(id);
      return true;
    } catch {
      this.persistenceFailed();
      this.imagesFallback.set(id, record);
      this.enforceFallbackCacheLimit();
      return false;
    }
  }

  async cacheUsage(): Promise<number> {
    try {
      const database = await this.getDB();
      return Number((await database.get('preferences', CACHE_BYTES_KEY))?.value ?? 0);
    } catch {
      return [...this.imagesFallback.values()].reduce((total, image) => total + image.size, 0)
        + [...this.cardsFallback.values()].reduce((total, entry) => total + (entry.size ?? encodedSize(entry.card)), 0);
    }
  }

  private async touchCache(database: IDBPDatabase<MeuMagicDB>, store: CacheEntry['store'], id: string, accessedAt: number): Promise<void> {
    const transaction = database.transaction('cacheEntries', 'readwrite');
    const entry = await transaction.store.get(cacheKey(store, id));
    // A concurrent eviction may already have removed this entry.
    if (entry) await transaction.store.put({ ...entry, accessedAt });
    await transaction.done;
  }

  private async writeCache(database: IDBPDatabase<MeuMagicDB>, store: CacheEntry['store'], records: (CachedCard | CachedImage)[]): Promise<void> {
    const transaction = database.transaction(['images', 'cards', 'cacheEntries', 'preferences'], 'readwrite');
    const metadata = transaction.objectStore('cacheEntries');
    const preferences = transaction.objectStore('preferences');
    let total = Number((await preferences.get(CACHE_BYTES_KEY))?.value ?? 0);
    for (const record of records) {
      const id = 'card' in record ? record.card.id : record.id;
      const size = 'card' in record ? record.size ?? encodedSize(record.card) : record.size;
      const key = cacheKey(store, id);
      const previous = await metadata.get(key);
      if ('card' in record) await transaction.objectStore('cards').put(record);
      else await transaction.objectStore('images').put(record);
      await metadata.put({ key, store, id, size, accessedAt: record.accessedAt });
      total += size - (previous?.size ?? 0);
    }
    // Only metadata is traversed, and only while over the limit.
    let cursor = total > this.cacheLimit ? await metadata.index('by-access').openCursor() : null;
    while (cursor && total > this.cacheLimit) {
      const candidate = cursor.value;
      await transaction.objectStore(candidate.store).delete(candidate.id);
      total -= candidate.size;
      await cursor.delete(); cursor = await cursor.continue();
    }
    await preferences.put({ key: CACHE_BYTES_KEY, value: total });
    await transaction.done;
  }

  private enforceFallbackCacheLimit(): void {
    const candidates = [
      ...[...this.imagesFallback.values()].map(entry => ({ store: 'images' as const, id: entry.id, size: entry.size, accessedAt: entry.accessedAt })),
      ...[...this.cardsFallback.values()].map(entry => ({ store: 'cards' as const, id: entry.card.id, size: entry.size ?? encodedSize(entry.card), accessedAt: entry.accessedAt })),
    ].sort((first, second) => first.accessedAt - second.accessedAt);
    let total = candidates.reduce((sum, entry) => sum + entry.size, 0);
    for (const candidate of candidates) {
      if (total <= this.cacheLimit) break;
      if (candidate.store === 'images') this.imagesFallback.delete(candidate.id);
      else this.cardsFallback.delete(candidate.id);
      total -= candidate.size;
    }
  }

  async getPreference<T>(key: string): Promise<T | undefined> {
    if (this.preferencesFallback.has(key)) return this.preferencesFallback.get(key) as T;
    try { return (await (await this.getDB()).get('preferences', key))?.value as T | undefined; }
    catch { this.persistenceFailed(); return undefined; }
  }

  async setPreference(key: string, value: unknown): Promise<void> {
    try { await (await this.getDB()).put('preferences', { key, value }); this.preferencesFallback.delete(key); }
    catch { this.persistenceFailed(); this.preferencesFallback.set(key, value); }
  }
}

export const localRepository = new LocalRepository();

function encodedSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function plain<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
