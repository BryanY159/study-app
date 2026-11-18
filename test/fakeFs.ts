import type { DirHandleLike, FileHandleLike, PermissionState } from '../src/storage/FsAccessDataStore';

/** In-memory stand-in for a FileSystemDirectoryHandle, with switches for failure cases. */
export class FakeDir implements DirHandleLike {
  files = new Map<string, string>();
  permission: PermissionState = 'granted';
  /** Answer to requestPermission (the click). */
  grantOnRequest: PermissionState = 'granted';
  /** Make the next N writes throw a generic error. */
  failWrites = 0;
  /** Simulate the folder being moved/deleted (NotFoundError on every call). */
  gone = false;
  writes = 0;

  constructor(readonly name = 'data') {}

  async queryPermission() {
    return this.permission;
  }

  async requestPermission() {
    this.permission = this.grantOnRequest;
    return this.permission;
  }

  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandleLike> {
    if (this.gone) throw new DOMException('A requested file or directory could not be found', 'NotFoundError');
    if (this.permission !== 'granted') throw new DOMException('Permission denied', 'NotAllowedError');
    if (!this.files.has(name) && !opts?.create) throw new DOMException('not found', 'NotFoundError');
    return {
      getFile: async () => ({ text: async () => this.files.get(name) ?? '' }),
      createWritable: async () => {
        let buf = '';
        return {
          write: async (d: string) => {
            if (this.failWrites > 0) {
              this.failWrites--;
              throw new Error('disk busy');
            }
            buf = d;
          },
          close: async () => {
            this.files.set(name, buf);
            this.writes++;
          },
        };
      },
    };
  }

  json(name: string): any {
    const t = this.files.get(name);
    return t === undefined ? undefined : JSON.parse(t);
  }
}
