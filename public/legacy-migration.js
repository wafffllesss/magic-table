const desktop = window.meuMagicDesktop;

async function send(event) {
  await desktop.sendLegacyMigrationEvent(event);
}

async function serialize(value) {
  if (value instanceof Blob) {
    const bytes = new Uint8Array(await value.arrayBuffer());
    let binary = '';
    const chunk = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunk) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
    }
    return { __meuMagicBlob: true, type: value.type, base64: btoa(binary) };
  }
  if (Array.isArray(value)) return Promise.all(value.map(serialize));
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Date) return { __meuMagicDate: value.toISOString() };
  const entries = await Promise.all(Object.entries(value).map(async ([key, child]) => [key, await serialize(child)]));
  return Object.fromEntries(entries);
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not read legacy local data.'));
  });
}

function openDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error(`Could not open ${name}.`));
    request.onupgradeneeded = () => {
      request.transaction.abort();
      reject(new Error(`The legacy database ${name} does not exist.`));
    };
  });
}

async function migrateDatabase(entry) {
  const name = entry.name;
  const database = await openDatabase(name);
  const stores = [...database.objectStoreNames].map(storeName => {
    const transaction = database.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    return {
      name: store.name,
      keyPath: store.keyPath,
      autoIncrement: store.autoIncrement,
      indexes: [...store.indexNames].map(indexName => {
        const index = store.index(indexName);
        return { name: index.name, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry };
      }),
    };
  });
  await send({ kind: 'database', name, version: entry.version, stores });

  for (const storeName of database.objectStoreNames) {
    const transaction = database.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const done = transactionDone(transaction);
    const [keys, values] = await Promise.all([requestResult(store.getAllKeys()), requestResult(store.getAll())]);
    await done;
    for (let index = 0; index < values.length; index += 1) {
      const value = await serialize(values[index]);
      if (database.name === 'firebaseLocalStorageDb') rewriteFirebaseAppName(value);
      await send({
        kind: 'record',
        name,
        store: storeName,
        ...(store.keyPath === null ? { key: await serialize(keys[index]) } : {}),
        value,
      });
    }
  }
  database.close();
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error('Could not read legacy data.'));
  });
}

function rewriteFirebaseAppName(value) {
  if (Array.isArray(value)) { value.forEach(rewriteFirebaseAppName); return; }
  if (!value || typeof value !== 'object') return;
  if (typeof value.fbase_key === 'string') value.fbase_key = value.fbase_key.replaceAll('mana-table', 'meu-magic');
  Object.values(value).forEach(rewriteFirebaseAppName);
}

async function run() {
  try {
    const databases = await indexedDB.databases();
    for (const database of databases) {
      if (!database.name || !database.version) continue;
      await migrateDatabase(database);
    }
    await send({ kind: 'complete' });
    await desktop.finishLegacyMigration();
  } catch (error) {
    await desktop.finishLegacyMigration(error instanceof Error ? error.message : String(error));
  }
}

void run();
