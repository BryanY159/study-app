import { rawText, setAsideName, type DataStore, type DocName, type SetAsideCopy } from './DataStore';
import { CardsDocSchema, emptyCards, emptyFlags, emptyProgress, FlagsDocSchema, ProgressDocSchema, type CardsDoc, type FlagsDoc, type ProgressDoc } from './docs';

export interface LoadedDocs {
  progress: ProgressDoc;
  flags: FlagsDoc;
  /** Flashcard progress (v2.0). */
  cards: CardsDoc;
  /** Docs that existed but didn't parse; a copy was kept and a fresh doc started. */
  recovered: DocName[];
  /** The unreadable data itself, so the app can offer it as a download. */
  setAside: SetAsideCopy[];
}

export async function loadDocs(store: DataStore): Promise<LoadedDocs> {
  const setAside: SetAsideCopy[] = [];
  const read = async <T>(doc: DocName, schema: { safeParse(x: unknown): { success: true; data: T } | { success: false } }, empty: () => T) => {
    const raw = await store.read(doc);
    if (raw === null) return empty();
    const parsed = schema.safeParse(raw);
    if (parsed.success) return parsed.data;
    // Never used, never lost: keep a copy before a fresh doc is started.
    const copy: SetAsideCopy = { doc, where: 'browser', name: setAsideName(doc), text: rawText(raw), reason: 'it could not be read' };
    await store.keepCopy?.(copy.name, copy.text);
    setAside.push(copy);
    return empty();
  };
  const progress = await read('progress', ProgressDocSchema, emptyProgress);
  const flags = await read('flags', FlagsDocSchema, emptyFlags);
  const cards = await read('cards', CardsDocSchema, emptyCards);
  setAside.push(...(store.takeSetAside?.() ?? []));
  const recovered = [...new Set(setAside.map((c) => c.doc))];
  return { progress, flags, cards, recovered, setAside };
}
