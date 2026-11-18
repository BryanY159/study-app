// Persistence boundary. The app only talks to a DataStore: browser storage,
// the data folder (FsAccessDataStore), or both (MirroredDataStore).

export type DocName = 'progress' | 'flags';

export interface WriteOptions {
  /** Replace the saved doc instead of merging into it (restore from backup). */
  replace?: boolean;
}

/** Saved data that couldn't be read. It is never used, and a copy is kept under `name`. */
export interface SetAsideCopy {
  doc: DocName;
  where: 'browser' | 'folder';
  /** e.g. progress.corrupt-2026-11-05T10-00-00-000Z.json */
  name: string;
  text: string;
  reason: string;
}

export interface DataStore {
  readonly kind: 'browser' | 'folder' | 'memory';
  read(doc: DocName): Promise<unknown | null>;
  write(doc: DocName, data: unknown, opts?: WriteOptions): Promise<void>;
  /** Keep a copy of unreadable data next to the real file. */
  keepCopy?(name: string, text: string): Promise<void>;
  /** Unreadable data found since the last call (MirroredDataStore). */
  takeSetAside?(): SetAsideCopy[];
}

export const setAsideName = (doc: DocName, now = new Date()): string => `${doc}.corrupt-${now.toISOString().replace(/[:.]/g, '-')}.json`;

/** The text to keep for a raw value read from storage. */
export const rawText = (raw: unknown): string =>
  raw && typeof raw === 'object' && '__unparseable' in raw ? String((raw as { __unparseable: unknown }).__unparseable) : JSON.stringify(raw, null, 2);

export class MemoryDataStore implements DataStore {
  readonly kind = 'memory' as const;
  readonly docs = new Map<DocName, string>();
  readonly copies = new Map<string, string>();
  async read(doc: DocName) {
    const raw = this.docs.get(doc);
    return raw === undefined ? null : JSON.parse(raw);
  }
  async write(doc: DocName, data: unknown) {
    this.docs.set(doc, JSON.stringify(data));
  }
  async keepCopy(name: string, text: string) {
    this.copies.set(name, text);
  }
}

export const STORAGE_PREFIX = 'studyapp:';
const COPY_PREFIX = `${STORAGE_PREFIX}set-aside:`;
/** Set-aside copies kept in the browser per doc; older ones are dropped so they can't fill the quota. */
const MAX_COPIES = 3;

/** localStorage-backed store. Synchronous underneath, async to match the interface. */
export class BrowserDataStore implements DataStore {
  readonly kind = 'browser' as const;
  private storage: Storage;

  /** Throws if the browser blocks storage for this page; the startup screen reports it. */
  constructor(storage?: Storage) {
    this.storage = storage ?? window.localStorage;
    this.storage.getItem(`${STORAGE_PREFIX}probe`);
  }

  async read(doc: DocName) {
    const raw = this.storage.getItem(STORAGE_PREFIX + doc);
    if (raw === null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return { __unparseable: raw };
    }
  }

  async write(doc: DocName, data: unknown) {
    this.storage.setItem(STORAGE_PREFIX + doc, JSON.stringify(data));
  }

  async keepCopy(name: string, text: string) {
    const doc = name.split('.')[0];
    const mine = listBrowserCopies(this.storage).filter((c) => c.name.startsWith(`${doc}.`));
    if (mine.some((c) => c.text === text)) return;
    for (const old of mine.slice(0, Math.max(0, mine.length - MAX_COPIES + 1))) this.storage.removeItem(COPY_PREFIX + old.name);
    this.storage.setItem(COPY_PREFIX + name, text);
  }
}

/** Set-aside copies kept in browser storage, oldest first. */
export function listBrowserCopies(storage: Storage): { name: string; text: string }[] {
  const out: { name: string; text: string }[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k?.startsWith(COPY_PREFIX)) out.push({ name: k.slice(COPY_PREFIX.length), text: storage.getItem(k) ?? '' });
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : 1));
}
