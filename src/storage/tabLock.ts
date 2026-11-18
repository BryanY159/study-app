// One tab saves at a time (Web Locks API). Two tabs each holding their own
// copy of the docs would overwrite each other's answers, so a second tab shows
// "already open in another tab" until she chooses "Use this tab instead",
// which steals the lock; the first tab is then told it lost it.

/** The part of navigator.locks we use; tests pass a fake. */
export interface LockManagerLike {
  request(name: string, options: { ifAvailable?: boolean; steal?: boolean }, callback: (lock: unknown | null) => Promise<void> | void): Promise<unknown>;
}

export const LOCK_NAME = 'studyapp-writer';

export class TabLock {
  private release: (() => void) | null = null;

  constructor(private locks: LockManagerLike | null) {}

  /**
   * Resolves true if this tab now holds the lock, false if another tab has it.
   * `onLost` runs if another tab takes it over later. Without Web Locks it always succeeds.
   */
  acquire(steal: boolean, onLost: () => void): Promise<boolean> {
    if (!this.locks) return Promise.resolve(true);
    return new Promise((resolve) => {
      let held = false;
      this.locks!.request(LOCK_NAME, steal ? { steal: true } : { ifAvailable: true }, (lock) => {
        if (!lock) return resolve(false);
        held = true;
        resolve(true);
        // Hold it until released or stolen.
        return new Promise<void>((r) => (this.release = r));
      }).catch(() => {
        // Stolen by another tab (AbortError). If locking itself fails, carry on without it.
        if (held) onLost();
        else resolve(true);
      });
    });
  }

  releaseLock(): void {
    this.release?.();
    this.release = null;
  }
}

export function browserLocks(): LockManagerLike | null {
  const l = (navigator as Navigator & { locks?: LockManagerLike }).locks;
  return l && typeof l.request === 'function' ? l : null;
}
