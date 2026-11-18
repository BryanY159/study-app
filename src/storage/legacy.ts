import { setAsideName, type DocName, type MetaStore, type SetAsideCopy } from './DataStore';
import type { SafeStore } from './SafeStore';
import { docCodec } from './sync';

// Up to v1.4.x, progress and flags lived in localStorage under "studyapp:" keys.
// On the first start of v1.5 they are moved into IndexedDB once:
//   - each doc is MERGED into whatever IndexedDB already has (never replaces it);
//   - unreadable data is set aside, never used; newer-version data is left alone;
//   - the old keys are NOT deleted (a free fallback copy until a later release),
//     and nothing in the app writes to them any more;
//   - meta.legacyMigratedAt records that it ran, so it never runs (or reads) again.
// If anything fails, the stamp isn't set and it simply tries again next start.

export const LEGACY_PREFIX = 'studyapp:';
const LEGACY_COPY_PREFIX = `${LEGACY_PREFIX}set-aside:`;
const DOCS: DocName[] = ['progress', 'flags'];

/** localStorage, or null if the browser blocks it for this page. */
export function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** A legacy doc as stored: parsed JSON, `{ __unparseable }` for broken JSON, or null if absent. */
export function readLegacyDoc(storage: Storage, doc: DocName): unknown | null {
  const raw = storage.getItem(LEGACY_PREFIX + doc);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { __unparseable: raw };
  }
}

/** Every raw "studyapp:" entry (for the rescue download). Read-only. */
export function legacyRawEntries(storage: Storage | null): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; storage && i < storage.length; i++) {
      const k = storage.key(i);
      if (k?.startsWith(LEGACY_PREFIX)) out[k] = storage.getItem(k) ?? '';
    }
  } catch {
    // Storage blocked part-way: keep what was read.
  }
  return out;
}

export interface MigrationResult {
  ran: boolean;
  migrated: DocName[];
}

export async function migrateLegacy(store: SafeStore, meta: MetaStore, storage: Storage | null, now = () => new Date()): Promise<MigrationResult> {
  if ((await meta.readMeta()).legacyMigratedAt) return { ran: false, migrated: [] };
  const migrated: DocName[] = [];
  if (storage) {
    for (const doc of DOCS) {
      const raw = readLegacyDoc(storage, doc);
      if (raw === null) continue;
      const p = docCodec.parse(doc, raw);
      if (p.ok) {
        await store.write(doc, p.value); // a merge write: what IndexedDB already has is kept
        migrated.push(doc);
      } else if (p.newerVersion) {
        store.noteNewerVersion();
      } else {
        const text = typeof raw === 'object' && raw && '__unparseable' in raw ? String((raw as { __unparseable: unknown }).__unparseable) : JSON.stringify(raw, null, 2);
        const copy: SetAsideCopy = { doc, where: 'legacy', name: setAsideName(doc, now()), text, reason: 'the copy saved by the previous version could not be read' };
        await store.inner.keepCopy?.(copy.name, copy.text);
        store.reportSetAside(copy);
      }
    }
    for (const [k, text] of Object.entries(legacyRawEntries(storage))) {
      if (k.startsWith(LEGACY_COPY_PREFIX)) await store.inner.keepCopy?.(k.slice(LEGACY_COPY_PREFIX.length), text);
    }
  }
  await meta.writeMeta({ legacyMigratedAt: now().toISOString() });
  return { ran: true, migrated };
}
