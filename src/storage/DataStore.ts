// Persistence boundary. The app talks to a SafeStore (merge rules, quarantine,
// newer-version protection) wrapped around a raw DataStore: IndexedDB in the
// browser (IdbDataStore), or MemoryDataStore in tests.

export type DocName = 'progress' | 'flags';

export interface WriteOptions {
  /** Replace the saved doc instead of merging into it (restore / Replace import). */
  replace?: boolean;
}

/** Saved data that couldn't be read. It is never used, and a copy is kept under `name`. */
export interface SetAsideCopy {
  doc: DocName;
  /** Where it was found: the IndexedDB copy, or the pre-v1.5 localStorage copy. */
  where: 'browser' | 'legacy';
  /** e.g. progress.corrupt-2026-11-05T10-00-00-000Z.json */
  name: string;
  text: string;
  reason: string;
}

export interface DataStore {
  readonly kind: 'browser' | 'memory';
  read(doc: DocName): Promise<unknown | null>;
  write(doc: DocName, data: unknown, opts?: WriteOptions): Promise<void>;
  /** Optional atomic read-change-write (IdbDataStore). Without it, SafeStore reads then writes. */
  update?(doc: DocName, fn: (current: unknown | null) => unknown): Promise<void>;
  /** Keep a copy of unreadable data. */
  keepCopy?(name: string, text: string): Promise<void>;
  /** Unreadable data found since the last call (SafeStore). */
  takeSetAside?(): SetAsideCopy[];
}

/** Small per-device values. They are never part of a sync file. */
export interface Meta {
  /** "Phone", "Laptop": written into each sync file this device exports. */
  deviceLabel?: string;
  /** ISO time of the last sync-file export from this device. */
  lastExportAt?: string;
  /** ISO time until which the backup reminder stays hidden. */
  reminderSnoozedUntil?: string;
  /** Last answer from navigator.storage (persisted() / persist()). */
  persisted?: boolean;
  /** ISO time the pre-v1.5 localStorage data was moved into IndexedDB. */
  legacyMigratedAt?: string;
}

export interface MetaStore {
  readMeta(): Promise<Meta>;
  /** Merges the patch; a field set to undefined is removed. */
  writeMeta(patch: Partial<Meta>): Promise<void>;
}

export const setAsideName = (doc: DocName, now = new Date()): string => `${doc}.corrupt-${now.toISOString().replace(/[:.]/g, '-')}.json`;

/** The text to keep for a raw value read from storage. */
export const rawText = (raw: unknown): string =>
  raw && typeof raw === 'object' && '__unparseable' in raw ? String((raw as { __unparseable: unknown }).__unparseable) : JSON.stringify(raw, null, 2);

export class MemoryDataStore implements DataStore, MetaStore {
  readonly kind = 'memory' as const;
  readonly docs = new Map<DocName, string>();
  readonly copies = new Map<string, string>();
  meta: Meta = {};
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
  async readMeta() {
    return { ...this.meta };
  }
  async writeMeta(patch: Partial<Meta>) {
    const next: Record<string, unknown> = { ...this.meta, ...patch };
    for (const [k, v] of Object.entries(next)) if (v === undefined) delete next[k];
    this.meta = next as Meta;
  }
}
