import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { CardDefinition, DeckDefinition } from '../domain/game';

export type CachedCard = { card: CardDefinition; cachedAt: number; accessedAt: number; size?: number };
export type CachedImage = { id: string; blob: Blob; cachedAt: number; accessedAt: number; size: number };

interface ManaTableDB extends DBSchema {
  decks: { key: string; value: DeckDefinition };
  cards: { key: string; value: CachedCard; indexes: { 'by-access': number } };
  images: { key: string; value: CachedImage; indexes: { 'by-access': number } };
  preferences: { key: string; value: { key: string; value: unknown } };
}

export const MAX_CARD_CACHE_BYTES = 200 * 1024 * 1024;
export const MAX_SINGLE_IMAGE_BYTES = 3 * 1024 * 1024;

class LocalRepository {
  private database?: Promise<IDBPDatabase<ManaTableDB>>;
  private cardsFallback = new Map<string, CachedCard>();
  private imagesFallback = new Map<string, CachedImage>();
  private decksFallback = new Map<string, DeckDefinition>();

  private getDB(): Promise<IDBPDatabase<ManaTableDB>> {
    if (!this.database) {
      this.database = openDB<ManaTableDB>('mana-table', 1, {
        upgrade(database, _oldVersion, _newVersion, transaction) {
          database.createObjectStore('preferences', { keyPath: 'key' });
          database.createObjectStore('decks', { keyPath: 'id' });
          const cards = database.createObjectStore('cards', { keyPath: 'card.id' });
          cards.createIndex('by-access', 'accessedAt');
          const images = database.createObjectStore('images', { keyPath: 'id' });
          images.createIndex('by-access', 'accessedAt');
          transaction.objectStore('preferences').put({ key: 'cache-version', value: 1 });
        },
      });
    }
    return this.database;
  }

  async getCard(id: string): Promise<CardDefinition | undefined> {
    return (await this.getCachedCard(id))?.card;
  }

  async getCachedCard(id: string): Promise<CachedCard | undefined> {
    try {
      const database = await this.getDB();
      const cached = await database.get('cards', id);
      if (!cached) return undefined;
      cached.accessedAt = Date.now();
      await database.put('cards', cached);
      return cached;
    } catch {
      const cached = this.cardsFallback.get(id);
      if (cached) cached.accessedAt = Date.now();
      return cached;
    }
  }

  async putCard(card: CardDefinition): Promise<void> {
    const record = { card, cachedAt: Date.now(), accessedAt: Date.now(), size: encodedSize(card) };
    try {
      const database = await this.getDB();
      await database.put('cards', record);
      await this.enforceCacheLimit(database);
    } catch {
      this.cardsFallback.set(card.id, record);
      this.enforceFallbackCacheLimit();
    }
  }

  async getDecks(): Promise<DeckDefinition[]> {
    try { return await (await this.getDB()).getAll('decks'); }
    catch { return [...this.decksFallback.values()]; }
  }

  async saveDeck(deck: DeckDefinition): Promise<void> {
    try { await (await this.getDB()).put('decks', deck); }
    catch { this.decksFallback.set(deck.id, structuredClone(deck)); }
  }

  async deleteDeck(id: string): Promise<void> {
    try { await (await this.getDB()).delete('decks', id); }
    catch { this.decksFallback.delete(id); }
  }

  async getImage(id: string): Promise<Blob | undefined> {
    try {
      const database = await this.getDB(); const cached = await database.get('images', id);
      if (!cached) return undefined;
      cached.accessedAt = Date.now(); await database.put('images', cached); return cached.blob;
    } catch { const cached = this.imagesFallback.get(id); if (cached) cached.accessedAt = Date.now(); return cached?.blob; }
  }

  async putImage(id: string, blob: Blob): Promise<boolean> {
    if (blob.size > MAX_SINGLE_IMAGE_BYTES) return false;
    const record: CachedImage = { id, blob, size: blob.size, cachedAt: Date.now(), accessedAt: Date.now() };
    try {
      const database = await this.getDB();
      await database.put('images', record);
      await this.enforceCacheLimit(database);
      return true;
    } catch {
      this.imagesFallback.set(id, record);
      this.enforceFallbackCacheLimit();
      return false;
    }
  }

  async cacheUsage(): Promise<number> {
    try {
      const database = await this.getDB();
      const [images, cards] = await Promise.all([database.getAll('images'), database.getAll('cards')]);
      return images.reduce((total, image) => total + image.size, 0) + cards.reduce((total, entry) => total + (entry.size ?? encodedSize(entry.card)), 0);
    } catch {
      return [...this.imagesFallback.values()].reduce((total, image) => total + image.size, 0)
        + [...this.cardsFallback.values()].reduce((total, entry) => total + (entry.size ?? encodedSize(entry.card)), 0);
    }
  }

  private async enforceCacheLimit(database: IDBPDatabase<ManaTableDB>): Promise<void> {
    const [images, cards] = await Promise.all([database.getAll('images'), database.getAll('cards')]);
    let total = images.reduce((sum, image) => sum + image.size, 0) + cards.reduce((sum, entry) => sum + (entry.size ?? encodedSize(entry.card)), 0);
    if (total <= MAX_CARD_CACHE_BYTES) return;
    const candidates = [
      ...images.map(entry => ({ store: 'images' as const, id: entry.id, size: entry.size, accessedAt: entry.accessedAt })),
      ...cards.map(entry => ({ store: 'cards' as const, id: entry.card.id, size: entry.size ?? encodedSize(entry.card), accessedAt: entry.accessedAt })),
    ].sort((first, second) => first.accessedAt - second.accessedAt);
    const transaction = database.transaction(['images', 'cards'], 'readwrite');
    for (const candidate of candidates) {
      if (total <= MAX_CARD_CACHE_BYTES) break;
      await transaction.objectStore(candidate.store).delete(candidate.id);
      total -= candidate.size;
    }
    await transaction.done;
  }

  private enforceFallbackCacheLimit(): void {
    const candidates = [
      ...[...this.imagesFallback.values()].map(entry => ({ store: 'images' as const, id: entry.id, size: entry.size, accessedAt: entry.accessedAt })),
      ...[...this.cardsFallback.values()].map(entry => ({ store: 'cards' as const, id: entry.card.id, size: entry.size ?? encodedSize(entry.card), accessedAt: entry.accessedAt })),
    ].sort((first, second) => first.accessedAt - second.accessedAt);
    let total = candidates.reduce((sum, entry) => sum + entry.size, 0);
    for (const candidate of candidates) {
      if (total <= MAX_CARD_CACHE_BYTES) break;
      if (candidate.store === 'images') this.imagesFallback.delete(candidate.id);
      else this.cardsFallback.delete(candidate.id);
      total -= candidate.size;
    }
  }

  async getPreference<T>(key: string): Promise<T | undefined> {
    try { return (await (await this.getDB()).get('preferences', key))?.value as T | undefined; }
    catch { return undefined; }
  }

  async setPreference(key: string, value: unknown): Promise<void> {
    try { await (await this.getDB()).put('preferences', { key, value }); } catch { /* session-only fallback */ }
  }
}

export const localRepository = new LocalRepository();

function encodedSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
