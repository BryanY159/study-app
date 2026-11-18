import type { DataStore, DocName } from './DataStore';

// The parts of the File System Access API we use. Declared here because the
// permission methods aren't in TypeScript's DOM types yet; tests pass fakes.

export type PermissionState = 'granted' | 'denied' | 'prompt';

export interface FileHandleLike {
  getFile(): Promise<{ text(): Promise<string> }>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}

export interface DirHandleLike {
  readonly name: string;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandleLike>;
  queryPermission(desc: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(desc: { mode: 'readwrite' }): Promise<PermissionState>;
}

/** Reads and writes data/progress.json and data/flags.json in the folder she picked. */
export class FsAccessDataStore implements DataStore {
  readonly kind = 'folder' as const;
  constructor(readonly dir: DirHandleLike) {}

  async read(doc: DocName): Promise<unknown | null> {
    let fh: FileHandleLike;
    try {
      fh = await this.dir.getFileHandle(`${doc}.json`);
    } catch (e) {
      // The file doesn't exist yet: a fresh folder.
      if ((e as DOMException).name === 'NotFoundError' || (e as DOMException).name === 'TypeMismatchError') return null;
      throw e;
    }
    const text = await (await fh.getFile()).text();
    if (!text.trim()) return null;
    try {
      return JSON.parse(text);
    } catch {
      return { __unparseable: text };
    }
  }

  async write(doc: DocName, data: unknown): Promise<void> {
    await this.writeFile(`${doc}.json`, JSON.stringify(data, null, 2));
  }

  /** A set-aside copy of unreadable data, e.g. progress.corrupt-<time>.json. */
  async keepCopy(name: string, text: string): Promise<void> {
    await this.writeFile(name, text);
  }

  private async writeFile(name: string, text: string): Promise<void> {
    const fh = await this.dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
  }
}
