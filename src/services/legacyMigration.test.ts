import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { importLegacyEvent, migrateLegacyDatabases } from './legacyMigration';

const databases = ['meu-magic', 'firebaseLocalStorageDb'];

afterEach(async () => {
  await Promise.all(databases.map(name => new Promise<void>(resolve => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  })));
  vi.unstubAllGlobals();
});

describe('Electron profile migration', () => {
  it('imports app data and cached images under the renamed database', async () => {
    await importLegacyEvent({
      kind: 'database', name: 'mana-table', version: 1,
      stores: [
        { name: 'decks', keyPath: 'id', autoIncrement: false, indexes: [] },
        { name: 'images', keyPath: 'id', autoIncrement: false, indexes: [] },
      ],
    });
    await importLegacyEvent({ kind: 'record', name: 'mana-table', store: 'decks', value: { id: 'deck-1', name: 'My deck' } });
    await importLegacyEvent({
      kind: 'record', name: 'mana-table', store: 'images', value: {
        id: 'card-front', blob: { __meuMagicBlob: true, type: 'image/png', base64: 'aGVsbG8=' },
        size: 5, cachedAt: 1, accessedAt: 1,
      },
    });

    const database = await openDB('meu-magic');
    expect(await database.get('decks', 'deck-1')).toEqual({ id: 'deck-1', name: 'My deck' });
    const image = await database.get('images', 'card-front');
    expect(image?.blob).toBeInstanceOf(Blob);
    expect(image?.blob.type).toBe('image/png');
    expect(await image?.blob.text()).toBe('hello');
    database.close();
  });

  it('rewrites the Firebase persistence key so the saved anonymous identity is reused', async () => {
    await importLegacyEvent({
      kind: 'database', name: 'firebaseLocalStorageDb', version: 1,
      stores: [{ name: 'firebaseLocalStorage', keyPath: 'fbase_key', autoIncrement: false, indexes: [] }],
    });
    await importLegacyEvent({
      kind: 'record', name: 'firebaseLocalStorageDb', store: 'firebaseLocalStorage',
      value: { fbase_key: 'firebase:authUser:api-key:mana-table', value: { uid: 'saved-user' } },
    });

    const database = await openDB('firebaseLocalStorageDb');
    expect(await database.get('firebaseLocalStorage', 'firebase:authUser:api-key:meu-magic'))
      .toEqual({ fbase_key: 'firebase:authUser:api-key:meu-magic', value: { uid: 'saved-user' } });
    database.close();
  });

  it('marks a successful migration once and skips it on later launches', async () => {
    const values = new Map<string, string>();
    let callback: ((payload: { id: string; event: unknown }) => void) | undefined;
    let calls = 0;
    const desktop = {
      isElectron: true as const,
      onLegacyMigrationEvent(next: typeof callback) { callback = next; return () => { callback = undefined; }; },
      acknowledgeLegacyMigrationEvent() {},
      async startLegacyMigration() {
        calls += 1;
        callback?.({ id: '1', event: { kind: 'complete' } });
        return true;
      },
    };
    vi.stubGlobal('window', { meuMagicDesktop: desktop } as unknown as Window);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });

    await migrateLegacyDatabases();
    await migrateLegacyDatabases();
    expect(calls).toBe(1);
  });
});
