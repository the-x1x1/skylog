import { MIGRATIONS } from '../migrations';
import { setBroadcastEnabled } from './changes';
import { Db } from './idb';

/**
 * The database name is intentionally neutral (not the product name) so renaming the product
 * never orphans a user's local journal.
 */
export const DB_NAME = 'conversation-journal';

export type StorageMode = 'persistent' | 'memory';

let dbPromise: Promise<Db> | null = null;
let storageMode: StorageMode = 'persistent';
let factoryOverride: IDBFactory | null = null;

/** Tests (and the in-memory fallback) can point the app at a different IndexedDB implementation. */
export function setIndexedDbFactory(factory: IDBFactory | null, mode: StorageMode = 'persistent') {
  factoryOverride = factory;
  storageMode = mode;
  setBroadcastEnabled(mode === 'persistent');
  dbPromise = null;
}

export function getStorageMode(): StorageMode {
  return storageMode;
}

async function openWithFallback(): Promise<Db> {
  if (factoryOverride) {
    return Db.open({ name: DB_NAME, migrations: MIGRATIONS, factory: factoryOverride, onVersionChange: resetDbHandle });
  }
  try {
    if (!globalThis.indexedDB) throw new Error('IndexedDB unavailable');
    return await Db.open({ name: DB_NAME, migrations: MIGRATIONS, onVersionChange: resetDbHandle });
  } catch (err) {
    // Private windows and some embedded previews block IndexedDB. Keep the app usable in memory
    // and tell the user nothing will persist (see StorageBanner).
    console.warn('Persistent storage unavailable; using in-memory storage.', err);
    const { indexedDB: memoryFactory } = await import('fake-indexeddb');
    storageMode = 'memory';
    setBroadcastEnabled(false);
    return Db.open({ name: DB_NAME, migrations: MIGRATIONS, factory: memoryFactory });
  }
}

function resetDbHandle() {
  dbPromise = null;
}

export function getDb(): Promise<Db> {
  if (!dbPromise) {
    dbPromise = openWithFallback();
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

export async function closeDb(): Promise<void> {
  if (!dbPromise) return;
  const db = await dbPromise.catch(() => null);
  db?.close();
  dbPromise = null;
}
