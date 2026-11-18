import { readRawData } from './IdbDataStore';
import { legacyRawEntries, safeLocalStorage } from './legacy';
import { emptyFlags, emptyProgress, FlagsDocSchema, ProgressDocSchema } from './docs';
import { makeSyncFile } from './syncFile';

// Getting a file off the device: the Share sheet on touch devices (iPhone/iPad:
// AirDrop, Files, Messages), a normal download everywhere else.

/** Save a file to the Downloads folder; works from file:// with no server. */
export function downloadFile(name: string, content: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The parts of navigator / window this needs; tests pass fakes. */
export interface ShareEnv {
  canShare?: (data: { files: File[] }) => boolean;
  share?: (data: { files: File[] }) => Promise<void>;
  /** True on a touch-first device. Desktop Chrome can share files too, but a download is what people expect there. */
  touch: boolean;
}

export const browserShareEnv = (): ShareEnv => ({
  canShare: typeof navigator.canShare === 'function' ? (d) => navigator.canShare(d) : undefined,
  share: typeof navigator.share === 'function' ? (d) => navigator.share(d) : undefined,
  touch: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
});

export type Delivery = 'shared' | 'downloaded' | 'cancelled';

/**
 * Must be called straight from the click handler, before any await: iOS only
 * opens the Share sheet while the tap still counts as the user's action.
 */
export async function deliverFile(name: string, text: string, env: ShareEnv = browserShareEnv()): Promise<Delivery> {
  if (env.touch && env.share && env.canShare) {
    const file = new File([text], name, { type: 'application/json' });
    if (env.canShare({ files: [file] })) {
      try {
        await env.share({ files: [file] });
        return 'shared';
      } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') return 'cancelled';
        // Share failed for another reason: fall back to a download.
      }
    }
  }
  downloadFile(name, text);
  return 'downloaded';
}

/**
 * For the error screens: whatever this device still holds, without the app.
 * A normal (importable) sync file when the saved docs parse, plus every raw entry under `raw`.
 */
export async function rescueBackup(now = new Date(), factory?: IDBFactory, storage: Storage | null = safeLocalStorage()): Promise<string> {
  const idb = await readRawData(factory);
  const legacy = legacyRawEntries(storage);
  const pick = <T>(schema: { safeParse(x: unknown): { success: true; data: T } | { success: false } }, ...candidates: unknown[]): T | null => {
    for (const c of candidates) {
      const r = schema.safeParse(c);
      if (r.success) return r.data;
    }
    return null;
  };
  const parseJson = (s: string | undefined) => {
    try {
      return s === undefined ? undefined : JSON.parse(s);
    } catch {
      return undefined;
    }
  };
  const progress = pick(ProgressDocSchema, idb?.progress, parseJson(legacy['studyapp:progress'])) ?? emptyProgress();
  const flags = pick(FlagsDocSchema, idb?.flags, parseJson(legacy['studyapp:flags'])) ?? emptyFlags();
  const raw = {
    indexedDB: idb ? { progress: idb.progress, flags: idb.flags, setAside: idb.copies } : 'could not be opened',
    localStorage: legacy,
  };
  return JSON.stringify({ ...makeSyncFile(progress, flags, { device: '', now }), raw }, null, 2);
}
