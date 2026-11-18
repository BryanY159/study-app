// Asking the browser to keep this site's data (navigator.storage.persist()).
// Without it, a browser may clear site data when the device is short of space.
// Safari decides by itself (installed home-screen apps fare better); Chrome
// grants it more readily to sites people use often.

/** The part of navigator.storage we use; tests pass a fake. */
export interface StorageManagerLike {
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
}

export type Persistence = 'persistent' | 'not-persistent' | 'unknown';

export const browserStorageManager = (): StorageManagerLike | null => (typeof navigator !== 'undefined' && navigator.storage ? navigator.storage : null);

/** Asks once per start while not yet granted. Never throws. */
export async function requestPersistence(sm: StorageManagerLike | null): Promise<Persistence> {
  if (!sm?.persisted && !sm?.persist) return 'unknown';
  try {
    if (sm.persisted && (await sm.persisted())) return 'persistent';
    if (sm.persist) return (await sm.persist()) ? 'persistent' : 'not-persistent';
    return 'not-persistent';
  } catch {
    return 'unknown';
  }
}
