/**
 * A deliberately small, typed wrapper over IndexedDB: versioned migrations, promise-based
 * transactions, and change notifications. Transactions follow the IndexedDB rule that only
 * IndexedDB requests may be awaited inside them (no fetch, no timers).
 */

export interface IndexDef {
  name: string;
  keyPath: string | string[];
  unique?: boolean;
  multiEntry?: boolean;
}

export interface StoreDef {
  name: string;
  keyPath: string;
  indexes?: IndexDef[];
}

export interface Migration {
  version: number;
  description: string;
  createStores?: StoreDef[];
  createIndexes?: { store: string; index: IndexDef }[];
  deleteStores?: string[];
  /** Data migration inside the versionchange transaction. Await only IndexedDB work. */
  upgrade?: (tx: Tx) => Promise<void>;
}

export function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

export type Key = IDBValidKey;
export type Query = IDBValidKey | IDBKeyRange | null | undefined;

export class Tx {
  constructor(readonly raw: IDBTransaction) {}

  store(name: string): IDBObjectStore {
    return this.raw.objectStore(name);
  }

  get<T>(store: string, key: Key): Promise<T | undefined> {
    return request(this.store(store).get(key)) as Promise<T | undefined>;
  }

  getAll<T>(store: string, query?: Query, count?: number): Promise<T[]> {
    return request(this.store(store).getAll(query ?? null, count)) as Promise<T[]>;
  }

  getAllFromIndex<T>(store: string, index: string, query?: Query, count?: number): Promise<T[]> {
    return request(this.store(store).index(index).getAll(query ?? null, count)) as Promise<T[]>;
  }

  getFromIndex<T>(store: string, index: string, query: Key | IDBKeyRange): Promise<T | undefined> {
    return request(this.store(store).index(index).get(query)) as Promise<T | undefined>;
  }

  getAllKeysFromIndex(store: string, index: string, query?: Query): Promise<Key[]> {
    return request(this.store(store).index(index).getAllKeys(query ?? null));
  }

  getAllKeys(store: string, query?: Query): Promise<Key[]> {
    return request(this.store(store).getAllKeys(query ?? null));
  }

  count(store: string, query?: Query, index?: string): Promise<number> {
    const s = this.store(store);
    return request(index ? s.index(index).count(query ?? undefined) : s.count(query ?? undefined));
  }

  put<T>(store: string, value: T): Promise<Key> {
    return request(this.store(store).put(value));
  }

  async putAll<T>(store: string, values: T[]): Promise<void> {
    const s = this.store(store);
    await Promise.all(values.map((v) => request(s.put(v))));
  }

  delete(store: string, key: Key | IDBKeyRange): Promise<void> {
    return request(this.store(store).delete(key)).then(() => undefined);
  }

  async deleteAll(store: string, keys: Key[]): Promise<void> {
    const s = this.store(store);
    await Promise.all(keys.map((k) => request(s.delete(k))));
  }

  clear(store: string): Promise<void> {
    return request(this.store(store).clear()).then(() => undefined);
  }
}

export interface OpenOptions {
  name: string;
  migrations: Migration[];
  factory?: IDBFactory;
  onVersionChange?: () => void;
}

export class Db {
  private constructor(
    readonly raw: IDBDatabase,
    readonly name: string,
  ) {}

  static async open(opts: OpenOptions): Promise<Db> {
    const factory = opts.factory ?? globalThis.indexedDB;
    if (!factory) throw new Error('IndexedDB is not available in this environment.');
    const migrations = [...opts.migrations].sort((a, b) => a.version - b.version);
    const target = migrations.at(-1)?.version ?? 1;

    const raw = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(opts.name, target);
      let upgradeError: unknown = null;
      req.onupgradeneeded = (event) => {
        const db = req.result;
        const tx = req.transaction;
        if (!tx) return;
        const from = event.oldVersion;
        const pending = migrations.filter((m) => m.version > from && m.version <= target);
        const wrapped = new Tx(tx);
        // Structural changes run synchronously, in version order, while the versionchange
        // transaction is guaranteed active. Data upgrades then run in version order on the same
        // transaction (so a failed data upgrade rolls back the whole version bump).
        try {
          for (const m of pending) {
            for (const name of m.deleteStores ?? []) {
              if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name);
            }
            for (const def of m.createStores ?? []) {
              const store = db.createObjectStore(def.name, { keyPath: def.keyPath });
              for (const idx of def.indexes ?? []) {
                store.createIndex(idx.name, idx.keyPath, { unique: !!idx.unique, multiEntry: !!idx.multiEntry });
              }
            }
            for (const { store, index } of m.createIndexes ?? []) {
              const s = tx.objectStore(store);
              if (!s.indexNames.contains(index.name)) {
                s.createIndex(index.name, index.keyPath, { unique: !!index.unique, multiEntry: !!index.multiEntry });
              }
            }
          }
        } catch (err) {
          upgradeError = err;
          tx.abort();
          return;
        }
        let chain: Promise<void> = Promise.resolve();
        for (const m of pending) {
          const upgrade = m.upgrade;
          if (upgrade) chain = chain.then(() => upgrade(wrapped));
        }
        chain.catch((err) => {
          upgradeError = err;
          try {
            tx.abort();
          } catch {
            /* already finished */
          }
        });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(upgradeError ?? req.error ?? new Error('Could not open the local database.'));
      req.onblocked = () => {
        /* another tab holds an older version open; it will close on versionchange */
      };
    });

    raw.onversionchange = () => {
      raw.close();
      opts.onVersionChange?.();
    };
    return new Db(raw, opts.name);
  }

  get version(): number {
    return this.raw.version;
  }

  get storeNames(): string[] {
    return Array.from(this.raw.objectStoreNames);
  }

  private run<R>(stores: string[], mode: IDBTransactionMode, fn: (tx: Tx) => Promise<R>, durability?: 'relaxed' | 'strict'): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = durability ? this.raw.transaction(stores, mode, { durability }) : this.raw.transaction(stores, mode);
      } catch (err) {
        reject(err);
        return;
      }
      let result: R;
      let failed = false;
      tx.oncomplete = () => {
        if (!failed) resolve(result);
      };
      tx.onabort = () => {
        if (!failed) reject(tx.error ?? new Error('Transaction aborted'));
      };
      tx.onerror = () => {
        /* handled by onabort */
      };
      fn(new Tx(tx)).then(
        (r) => {
          result = r;
        },
        (err) => {
          failed = true;
          try {
            tx.abort();
          } catch {
            /* already finished */
          }
          reject(err);
        },
      );
    });
  }

  read<R>(stores: string | string[], fn: (tx: Tx) => Promise<R>): Promise<R> {
    return this.run(Array.isArray(stores) ? stores : [stores], 'readonly', fn);
  }

  /**
   * `relaxed` durability skips the per-transaction disk flush; used for bulk imports, where the
   * worst case after a power loss is re-importing the last few conversations.
   */
  write<R>(stores: string | string[], fn: (tx: Tx) => Promise<R>, opts: { durability?: 'relaxed' | 'strict' } = {}): Promise<R> {
    return this.run(Array.isArray(stores) ? stores : [stores], 'readwrite', fn, opts.durability);
  }

  close(): void {
    this.raw.close();
  }
}
