import { createStore, del, get, set, type UseStore } from 'idb-keyval';
import { parsePack } from '../pack/checks';
import type { Pack } from '../pack/schema';

// Imported packs live in IndexedDB (they can be large). One entry per packId.

let db: UseStore | undefined;
const store = () => (db ??= createStore('studyapp-packs', 'packs'));
const KEY = 'imported';

export async function loadImportedPacks(): Promise<Pack[]> {
  const raw = ((await get(KEY, store())) as unknown[] | undefined) ?? [];
  // Re-validate on load; a pack that no longer parses is dropped quietly.
  return raw.flatMap((p) => {
    const r = parsePack(p);
    return r.ok ? [r.pack] : [];
  });
}

export async function saveImportedPack(pack: Pack): Promise<void> {
  const existing = await loadImportedPacks();
  await set(KEY, [...existing.filter((p) => p.packId !== pack.packId), pack], store());
}

export async function clearImportedPacks(): Promise<void> {
  await del(KEY, store());
}

/** Bundled + imported: the highest version of each packId wins. */
export function choosePacks(bundled: Pack[], imported: Pack[]): Pack[] {
  const best = new Map<string, Pack>();
  for (const p of [...bundled, ...imported]) {
    const cur = best.get(p.packId);
    if (!cur || p.version > cur.version) best.set(p.packId, p);
  }
  return [...best.values()];
}
