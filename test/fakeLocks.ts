import type { LockManagerLike } from '../src/storage/tabLock';

/** One shared Web Locks manager for several "tabs" in a test (ifAvailable + steal only). */
export class FakeLocks implements LockManagerLike {
  private holder: { reject: (e: unknown) => void } | null = null;

  async request(_name: string, opts: { ifAvailable?: boolean; steal?: boolean }, cb: (lock: unknown | null) => Promise<void> | void): Promise<unknown> {
    if (this.holder && !opts.steal) return cb(null);
    if (this.holder) {
      this.holder.reject(new DOMException('The lock was stolen', 'AbortError'));
      this.holder = null;
    }
    return new Promise((resolve, reject) => {
      const me = { reject };
      this.holder = me;
      void Promise.resolve(cb({})).then((v) => {
        if (this.holder === me) this.holder = null;
        resolve(v);
      });
    });
  }
}
