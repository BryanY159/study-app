import { rawText, setAsideName, type DataStore, type DocName, type SetAsideCopy, type WriteOptions } from './DataStore';
import { docCodec, type DocCodec } from './sync';

// The protections every save goes through (kept from v1.4, minus the data folder):
//   - Every write MERGES with what is already saved (see sync.ts) instead of
//     replacing it, so a stale in-memory copy can never wipe out saved answers or
//     flags. Only a restore / Replace import replaces (`replace`).
//   - Saved data that fails to parse is never used: a copy is kept as
//     <doc>.corrupt-<time>.json and reported to the app.
//   - Saved data from a NEWER app version is never written over: that doc is
//     frozen, and the app asks her to update.
//   - Once this tab loses the one-tab lock, `close()` stops all further writes.

const NEWER = 'This device has data from a newer version of the app; it is left untouched.';

export class SafeStore implements DataStore {
  readonly kind: DataStore['kind'];
  private setAside: SetAsideCopy[] = [];
  private seen = new Set<string>();
  /** Docs whose saved copy came from a newer app version: never written here. */
  private frozen = new Set<DocName>();
  private newerElsewhere = false;
  private closed = false;

  constructor(
    readonly inner: DataStore,
    private codec: DocCodec = docCodec,
  ) {
    this.kind = inner.kind;
  }

  /** Some saved data came from a newer version of the app (and is being left alone). */
  get newerVersionData(): boolean {
    return this.newerElsewhere || this.frozen.size > 0;
  }

  /** The legacy migration found newer-version data: report it the same way. */
  noteNewerVersion(): void {
    this.newerElsewhere = true;
  }

  /** Unreadable data found since the last call. */
  takeSetAside(): SetAsideCopy[] {
    const out = this.setAside;
    this.setAside = [];
    return out;
  }

  /** Report a copy set aside by someone else (the legacy migration). */
  reportSetAside(copy: SetAsideCopy): void {
    this.setAside.push(copy);
  }

  /** Another tab took over: nothing more is saved from this one. */
  close(): void {
    this.closed = true;
  }

  /** The saved doc if it's valid; null if it's missing, unreadable (set aside) or from a newer version (frozen). */
  async read(doc: DocName): Promise<unknown | null> {
    const raw = await this.inner.read(doc);
    if (raw === null) return null;
    const p = this.codec.parse(doc, raw);
    if (p.ok) return p.value;
    if (p.newerVersion) {
      this.frozen.add(doc);
      return null;
    }
    await this.keepSetAside(doc, raw, p.reason);
    return null;
  }

  async write(doc: DocName, data: unknown, opts: WriteOptions = {}): Promise<void> {
    if (this.closed) throw new Error('This tab no longer saves: the app is open in another tab.');
    const parsed = this.codec.parse(doc, data);
    if (!parsed.ok) throw new Error(`Refusing to save ${doc}: ${parsed.reason}`);
    if (this.frozen.has(doc)) throw new Error(NEWER);
    const value = parsed.value;
    let unreadable: { raw: unknown; reason: string } | null = null;
    // Decides what to save from what's saved now. Synchronous, so IdbDataStore can run it inside one transaction.
    const next = (raw: unknown | null): unknown => {
      if (raw === null) return value;
      const p = this.codec.parse(doc, raw);
      if (!p.ok && p.newerVersion) {
        this.frozen.add(doc);
        throw new Error(NEWER);
      }
      if (opts.replace) return value;
      if (p.ok) return this.codec.merge(doc, value, p.value);
      unreadable = { raw, reason: p.reason };
      return value;
    };
    if (this.inner.update) await this.inner.update(doc, next);
    else await this.inner.write(doc, next(await this.inner.read(doc)));
    // Normally already set aside at load; this catches data that went bad since.
    const bad = unreadable as { raw: unknown; reason: string } | null;
    if (bad) await this.keepSetAside(doc, bad.raw, bad.reason);
  }

  private async keepSetAside(doc: DocName, raw: unknown, reason: string) {
    const text = rawText(raw);
    const key = `${doc}|${text}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    const name = setAsideName(doc);
    await this.inner.keepCopy?.(name, text).catch(() => undefined);
    this.setAside.push({ doc, where: 'browser', name, text, reason });
  }
}
