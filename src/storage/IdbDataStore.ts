import type { DataStore, DocName, Meta, MetaStore } from './DataStore';

// All saved data lives in one IndexedDB database (iOS caps localStorage at ~5 MB):
//   docs      key = 'progress' | 'flags'         value = the doc (structured clone, not a JSON string)
//   setAside  key = progress.corrupt-<time>.json  value = { name, text }
//   meta      key = a Meta field                  value = its value (device-local, never synced)
// Imported packs stay in their own database (packStore.ts).
//
// The raw IndexedDB API is callback-based; `done()` turns a request into a
// promise. That ~10-line helper is all we need, so there's no extra dependency.

export const DATA_DB = 'studyapp-data';
const DB_VERSION = 1;
const STORES = ['docs', 'setAside', 'meta'] as const;
type StoreName = (typeof STORES)[number];

/**
 * Writes ask for strict durability: 'complete' fires only once the data is on disk.
 * The default ('relaxed' in some browsers) may report success while the data is
 * still in memory, so an answer given just before the app closes or reloads could be
 * lost. Found by the e2e tests on WebKit; the cost is a few ms per save.
 */
const STRICT: IDBTransactionOptions = { durability: 'strict' };

/** Set-aside copies kept per doc; older ones are dropped so they can't fill the quota. */
export const MAX_COPIES = 3;

const done = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DATA_DB, DB_VERSION);
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('The saved-data database is blocked by another open copy of the app.'));
  });
}

export class IdbDataStore implements DataStore, MetaStore {
  readonly kind = 'browser' as const;

  private constructor(private db: IDBDatabase) {}

  /** Opens (or creates) the database. Rejects if the browser blocks storage; Boot shows the error screen. */
  static async open(factory: IDBFactory = indexedDB): Promise<IdbDataStore> {
    return new IdbDataStore(await openDb(factory));
  }

  private async run<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const tx = mode === 'readwrite' ? this.db.transaction(store, mode, STRICT) : this.db.transaction(store, mode);
    const result = done(fn(tx.objectStore(store)));
    result.catch(() => undefined); // the transaction error below is the one reported
    // Resolve only once the transaction has committed, so a "saved" write really is on disk.
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Saving was aborted'));
    });
    return result;
  }

  async read(doc: DocName): Promise<unknown | null> {
    return (await this.run('docs', 'readonly', (s) => s.get(doc))) ?? null;
  }

  async write(doc: DocName, data: unknown): Promise<void> {
    await this.run('docs', 'readwrite', (s) => s.put(data, doc));
  }

  /**
   * Read, change and save a doc in ONE transaction. `fn` runs synchronously inside
   * it, so there's no gap between reading and writing: an answer saved just before
   * the page closes or reloads isn't lost between two separate steps. If `fn`
   * throws, nothing is written and the error is passed on.
   */
  async update(doc: DocName, fn: (current: unknown | null) => unknown): Promise<void> {
    const tx = this.db.transaction('docs', 'readwrite', STRICT);
    const s = tx.objectStore('docs');
    const get = s.get(doc);
    let failure: unknown = null;
    get.onsuccess = () => {
      try {
        s.put(fn(get.result ?? null), doc);
      } catch (e) {
        failure = e;
        tx.abort();
      }
    };
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => e.preventDefault();
      tx.onabort = () => reject(failure ?? tx.error ?? new Error('Saving was aborted'));
    });
  }

  async keepCopy(name: string, text: string): Promise<void> {
    const doc = name.split('.')[0];
    const mine = (await this.listCopies()).filter((c) => c.name.startsWith(`${doc}.`));
    if (mine.some((c) => c.text === text)) return;
    const drop = mine.slice(0, Math.max(0, mine.length - MAX_COPIES + 1));
    const tx = this.db.transaction('setAside', 'readwrite', STRICT);
    const s = tx.objectStore('setAside');
    for (const old of drop) s.delete(old.name);
    s.put({ name, text }, name);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /** Set-aside copies, oldest first (names embed an ISO time). */
  async listCopies(): Promise<{ name: string; text: string }[]> {
    const all = (await this.run('setAside', 'readonly', (s) => s.getAll())) as { name: string; text: string }[];
    return all.sort((a, b) => (a.name < b.name ? -1 : 1));
  }

  async readMeta(): Promise<Meta> {
    const tx = this.db.transaction('meta', 'readonly');
    const s = tx.objectStore('meta');
    const [keys, values] = await Promise.all([done(s.getAllKeys()), done(s.getAll())]);
    return Object.fromEntries(keys.map((k, i) => [String(k), values[i]])) as Meta;
  }

  async writeMeta(patch: Partial<Meta>): Promise<void> {
    const tx = this.db.transaction('meta', 'readwrite', STRICT);
    const s = tx.objectStore('meta');
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) s.delete(k);
      else s.put(v, k);
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  close(): void {
    this.db.close();
  }
}

/**
 * For the error screens: read whatever the database still holds, without the app.
 * Returns null if it can't be opened at all.
 */
export async function readRawData(factory: IDBFactory | undefined = globalThis.indexedDB): Promise<{ progress: unknown; flags: unknown; copies: { name: string; text: string }[] } | null> {
  if (!factory) return null;
  try {
    const s = await IdbDataStore.open(factory);
    try {
      return { progress: await s.read('progress'), flags: await s.read('flags'), copies: await s.listCopies() };
    } finally {
      s.close();
    }
  } catch {
    return null;
  }
}
