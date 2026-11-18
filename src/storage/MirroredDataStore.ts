import { rawText, setAsideName, type DataStore, type DocName, type SetAsideCopy, type WriteOptions } from './DataStore';
import { docCodec, sameDoc, type DocCodec } from './sync';

// Writes every change to the browser copy right away, and to the data folder
// (when connected) through a small queue. Folder writes are slow (~300 ms each
// in the spike), so the queue keeps only the latest pending version of each
// document, and it retries failures with backoff.
//
// Every write and sync MERGES with what is already saved (see sync.ts) instead
// of replacing it, so a stale or partial copy can never wipe out answers or
// flags the other copy has. Only a restore from backup replaces (`replace`).
// Data that fails to parse is never used: a copy is kept as
// <doc>.corrupt-<time>.json on the side it came from, and it's reported to the app.
// Data saved by a NEWER app version is never written over at all: the folder is
// dropped (browser-only saving) and the app asks her to update index.html.

export type MirrorStatus =
  | { kind: 'browser-only' } // no folder connected (skipped, or waiting for reconnect)
  | { kind: 'saving' }
  | { kind: 'folder' } // everything written to the data folder
  | { kind: 'failed'; error: string } // folder write failed; retrying (browser copy is safe)
  | { kind: 'lost-access'; error: string } // folder moved or permission gone; needs reconnect
  | { kind: 'browser-failed'; error: string } // even the browser copy failed
  | { kind: 'newer-version' }; // the folder has data from a newer app version: left alone, browser only

const DOCS: DocName[] = ['progress', 'flags'];

/** The folder holds data from a newer app version; it must not be written. */
export class NewerVersionError extends Error {
  name = 'NewerVersionError';
}

const isAccessError = (e: unknown) => {
  const name = (e as { name?: string })?.name;
  return name === 'NotAllowedError' || name === 'NotFoundError' || name === 'SecurityError';
};

export interface MirrorOptions {
  /** Retry delays in ms (last one repeats). Tests pass tiny values. */
  retryDelays?: number[];
  codec?: DocCodec;
}

interface Pending {
  data: unknown;
  replace: boolean;
}

export class MirroredDataStore implements DataStore {
  readonly kind = 'browser' as const;
  private folder: DataStore | null = null;
  private pending = new Map<DocName, Pending>();
  private running: Promise<void> | null = null;
  private failures = 0;
  private status: MirrorStatus = { kind: 'browser-only' };
  private listeners = new Set<(s: MirrorStatus) => void>();
  private retryDelays: number[];
  private codec: DocCodec;
  private setAside: SetAsideCopy[] = [];
  private seen = new Set<string>();
  /** Docs whose browser copy was saved by a newer app version: never written here. */
  private frozenBrowser = new Set<DocName>();
  private newerFolder = false;

  constructor(
    private browser: DataStore,
    opts: MirrorOptions = {},
  ) {
    this.retryDelays = opts.retryDelays ?? [1000, 2000, 5000, 10000, 30000];
    this.codec = opts.codec ?? docCodec;
  }

  get connected(): boolean {
    return this.folder !== null;
  }

  getStatus(): MirrorStatus {
    return this.status;
  }

  subscribe(fn: (s: MirrorStatus) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private setStatus(s: MirrorStatus) {
    this.status = s;
    for (const fn of this.listeners) fn(s);
  }

  /** Some saved data came from a newer version of the app (and is being left alone). */
  get newerVersionData(): boolean {
    return this.newerFolder || this.frozenBrowser.size > 0;
  }

  /** Unreadable data found since the last call. */
  takeSetAside(): SetAsideCopy[] {
    const out = this.setAside;
    this.setAside = [];
    return out;
  }

  /**
   * Connect a folder and sync both ways: each doc is merged and the result is
   * written to whichever side was missing something. Returns the docs whose
   * browser copy changed (the app should reload those).
   */
  async attach(folder: DataStore): Promise<DocName[]> {
    this.folder = folder;
    this.failures = 0;
    const changed: DocName[] = [];
    try {
      this.setStatus({ kind: 'saving' });
      // Check every folder file first: if any is from a newer app version, write none of them.
      for (const doc of DOCS) await this.readSide(doc, folder, 'folder');
      for (const doc of DOCS) if (await this.syncDoc(doc, folder)) changed.push(doc);
      // Detached meanwhile (startup timed out): don't claim to be connected.
      if (this.folder !== folder) return changed;
      this.setStatus({ kind: 'folder' });
    } catch (e) {
      if (this.folder !== folder) return changed;
      // A retryable failure: queue the browser copies; queued writes merge, so the folder catches up without losing anything.
      if (!this.handleFolderError(e)) await this.queueBrowserCopies();
    }
    return changed;
  }

  detach(): void {
    this.folder = null;
    this.pending.clear();
    this.setStatus({ kind: 'browser-only' });
  }

  /** The merged doc (browser copy, synced with the folder when connected). */
  async read(doc: DocName): Promise<unknown | null> {
    if (this.folder) {
      try {
        await this.syncDoc(doc, this.folder);
      } catch (e) {
        if (!this.handleFolderError(e)) await this.queueBrowserCopies();
      }
    }
    return this.readSide(doc, this.browser, 'browser');
  }

  async write(doc: DocName, data: unknown, opts: WriteOptions = {}): Promise<void> {
    const parsed = this.codec.parse(doc, data);
    if (!parsed.ok) throw new Error(`Refusing to save ${doc}: ${parsed.reason}`);
    const replace = !!opts.replace;
    try {
      const cur = replace ? null : await this.readSide(doc, this.browser, 'browser');
      if (this.frozenBrowser.has(doc)) throw new NewerVersionError('This browser has data from a newer version of the app');
      await this.browser.write(doc, cur === null ? parsed.value : this.codec.merge(doc, parsed.value, cur));
    } catch (e) {
      this.setStatus({ kind: 'browser-failed', error: String((e as Error)?.message ?? e) });
      // Still try the folder: it may be the only place this change can land.
      if (!this.folder) throw e;
    }
    if (this.folder) this.queue(doc, parsed.value, replace);
  }

  /** Resolves when the folder queue is empty (or the folder is gone). For tests and before-unload. */
  async flush(): Promise<void> {
    while (this.running) await this.running;
  }

  /** One side's doc if it's valid; null if it's missing or unreadable (unreadable data is set aside). */
  private async readSide(doc: DocName, store: DataStore, where: SetAsideCopy['where']): Promise<unknown | null> {
    const raw = await store.read(doc);
    if (raw === null) return null;
    const p = this.codec.parse(doc, raw);
    if (p.ok) return p.value;
    if (p.newerVersion) {
      if (where === 'folder') throw new NewerVersionError(`${doc}.json was saved by a newer version of the app`);
      this.frozenBrowser.add(doc);
      return null;
    }
    await this.keepSetAside(doc, raw, where, p.reason, store);
    return null;
  }

  private async keepSetAside(doc: DocName, raw: unknown, where: SetAsideCopy['where'], reason: string, store: DataStore) {
    const text = rawText(raw);
    const key = `${where}|${doc}|${text}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    const name = setAsideName(doc);
    try {
      await store.keepCopy?.(name, text);
    } catch {
      // Couldn't write it there: keep it in the browser instead (the app also offers it as a download).
      await this.browser.keepCopy?.(name, text).catch(() => undefined);
    }
    this.setAside.push({ doc, where, name, text, reason });
  }

  /** Merge one doc across both sides. Returns true if the browser copy changed. */
  private async syncDoc(doc: DocName, folder: DataStore): Promise<boolean> {
    const b = await this.readSide(doc, this.browser, 'browser');
    const f = await this.readSide(doc, folder, 'folder');
    const merged = b !== null && f !== null ? this.codec.merge(doc, b, f) : (b ?? f);
    if (merged === null) return false;
    const browserChanged = !sameDoc(merged, b);
    if (browserChanged && !this.frozenBrowser.has(doc)) await this.browser.write(doc, merged);
    if (!sameDoc(merged, f)) await folder.write(doc, merged);
    return browserChanged;
  }

  private async queueBrowserCopies() {
    for (const doc of DOCS) {
      const b = await this.readSide(doc, this.browser, 'browser').catch(() => null);
      if (b !== null) this.queue(doc, b, false);
    }
  }

  private queue(doc: DocName, data: unknown, replace: boolean) {
    // A pending restore stays a restore: later writes are built on the restored data.
    this.pending.set(doc, { data, replace: replace || !!this.pending.get(doc)?.replace });
    if (this.status.kind !== 'failed') this.setStatus({ kind: 'saving' });
    if (!this.running) this.running = this.drain().finally(() => (this.running = null));
  }

  private async drain(): Promise<void> {
    while (this.folder && this.pending.size) {
      const [doc, item] = this.pending.entries().next().value as [DocName, Pending];
      this.pending.delete(doc);
      try {
        const cur = item.replace ? null : await this.readSide(doc, this.folder, 'folder');
        const out = cur === null ? item.data : this.codec.merge(doc, item.data, cur);
        if (!sameDoc(out, cur)) await this.folder.write(doc, out);
        this.failures = 0;
      } catch (e) {
        // Put it back unless a newer version arrived meanwhile.
        const newer = this.pending.get(doc);
        this.pending.set(doc, newer ? { ...newer, replace: newer.replace || item.replace } : item);
        if (this.handleFolderError(e)) return;
        const delay = this.retryDelays[Math.min(this.failures - 1, this.retryDelays.length - 1)];
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    if (this.folder && !this.pending.size) this.setStatus({ kind: 'folder' });
  }

  /** Returns true if the folder was dropped (access lost); otherwise counts a retryable failure. */
  private handleFolderError(e: unknown): boolean {
    const error = String((e as Error)?.message ?? e);
    if (e instanceof NewerVersionError) {
      this.folder = null;
      this.pending.clear();
      this.newerFolder = true;
      this.setStatus({ kind: 'newer-version' });
      return true;
    }
    if (isAccessError(e)) {
      this.folder = null;
      this.pending.clear(); // the browser copy has it; synced on reconnect
      this.setStatus({ kind: 'lost-access', error });
      return true;
    }
    this.failures++;
    this.setStatus({ kind: 'failed', error });
    return false;
  }
}
