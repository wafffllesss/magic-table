type LegacyStore = { name: string; keyPath: string | string[] | null; autoIncrement: boolean; indexes: Array<{ name: string; keyPath: string | string[]; unique: boolean; multiEntry: boolean }> };
type LegacyEvent =
  | { kind: 'database'; name: string; version: number; stores: LegacyStore[] }
  | { kind: 'record'; name: string; store: string; key?: IDBValidKey; value: unknown }
  | { kind: 'complete' };

const MIGRATION_KEY = 'meu-magic:legacy-profile-migrated:v1';

export async function migrateLegacyDatabases(): Promise<void> {
  const desktop = window.meuMagicDesktop;
  if (!desktop || localStorage.getItem(MIGRATION_KEY) === 'done') return;

  let failed = false;
  const unsubscribe = desktop.onLegacyMigrationEvent(({ id, event }) => {
    void importLegacyEvent(event as LegacyEvent).then(
      () => desktop.acknowledgeLegacyMigrationEvent(id),
      error => {
        failed = true;
        desktop.acknowledgeLegacyMigrationEvent(id, error instanceof Error ? error.message : String(error));
      },
    );
  });
  try {
    await desktop.startLegacyMigration();
    if (!failed) localStorage.setItem(MIGRATION_KEY, 'done');
  } finally {
    unsubscribe();
  }
}

export async function importLegacyEvent(event: LegacyEvent): Promise<void> {
  if (event.kind === 'complete') return;
  if (event.kind === 'database') {
    const name = currentDatabaseName(event.name);
    const request = indexedDB.open(name, event.version);
    request.onupgradeneeded = () => {
      for (const store of event.stores) {
        if (request.result.objectStoreNames.contains(store.name)) continue;
        const options: IDBObjectStoreParameters = { autoIncrement: store.autoIncrement };
        if (store.keyPath !== null) options.keyPath = store.keyPath;
        const objectStore = request.result.createObjectStore(store.name, options);
        for (const index of store.indexes) objectStore.createIndex(index.name, index.keyPath, {
          unique: index.unique,
          multiEntry: index.multiEntry,
        });
      }
    };
    const database = await requestResult(request);
    database.close();
    return;
  }

  const name = currentDatabaseName(event.name);
  const database = await openExistingDatabase(name);
  const transaction = database.transaction(event.store, 'readwrite');
  const store = transaction.objectStore(event.store);
  const value = await restoreValue(event.value, name);
  if (store.keyPath === null) store.put(value, await restoreValue(event.key, name) as IDBValidKey);
  else store.put(value);
  await transactionDone(transaction);
  database.close();
}

function currentDatabaseName(name: string): string {
  return name === 'mana-table' ? 'meu-magic' : name;
}

async function restoreValue(value: unknown, databaseName: string): Promise<unknown> {
  if (Array.isArray(value)) return Promise.all(value.map(child => restoreValue(child, databaseName)));
  if (!value || typeof value !== 'object') return value;
  const object = value as Record<string, unknown>;
  if (typeof object.__meuMagicDate === 'string') return new Date(object.__meuMagicDate);
  if (object.__meuMagicBlob === true && typeof object.type === 'string' && typeof object.base64 === 'string') {
    const binary = atob(object.base64);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    return new Blob([bytes], { type: object.type });
  }
  const entries = await Promise.all(Object.entries(object).map(async ([key, child]) => [key, await restoreValue(child, databaseName)] as const));
  const restored = Object.fromEntries(entries);
  // Firebase keys include the SDK's named app. Keep persisted anonymous identity
  // available after the app instance is renamed.
  if (nameLooksLikeFirebase(databaseName) && typeof restored.fbase_key === 'string') {
    restored.fbase_key = (restored.fbase_key as string).replaceAll('mana-table', 'meu-magic');
  }
  return restored;
}

// Firebase's auth database is the only legacy database whose key embeds the old app name.
function nameLooksLikeFirebase(name: string): boolean { return name === 'firebaseLocalStorageDb'; }

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Não foi possível importar os dados locais.'));
  });
}

function openExistingDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Não foi possível abrir o perfil Meu Magic.'));
    request.onupgradeneeded = () => {
      request.transaction?.abort();
      reject(new Error(`A estrutura do banco ${name} não foi importada.`));
    };
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error('Não foi possível gravar os dados importados.'));
  });
}
