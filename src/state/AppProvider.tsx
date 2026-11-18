import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { parsePack, formatIssues } from '../pack/checks';
import type { Pack } from '../pack/schema';
import { prunePreflags, seedPreflags } from '../engine/flags';
import { indexPack, type PackIndex } from '../engine/packIndex';
import type { DataStore, Meta, MetaStore, SetAsideCopy } from '../storage/DataStore';
import { nextState, type Rating } from '../engine/leitner';
import { cardKey, emptyCards, type Attempt, type CardsDoc, type CardStateDoc, type Flag, type FlagsDoc, type ProgressDoc, type Session } from '../storage/docs';
import { loadDocs } from '../storage/load';
import { choosePacks, loadImportedPacks, saveImportedPack } from '../storage/packStore';
import { noUpdates, type UpdateSource } from '../pwa/updates';
import { browserShareEnv, type ShareEnv } from '../storage/backup';
import { requestPersistence, type Persistence, type StorageManagerLike } from '../storage/persist';
import { mergeCardsForSync, mergeFlagsForSync, mergeProgressForSync, sameDoc } from '../storage/sync';
import { cleanLabel, type SyncFile } from '../storage/syncFile';
import { StartupError } from '../ui/screens/StartupError';

export type SaveStatus = 'saved' | 'saving' | 'error';

/** A card session in progress. */
export interface CardRun {
  packId: string;
  mode: 'due-new' | 'due' | 'cram';
  /** Card ids in order; Again re-inserts a card later in the queue. */
  queue: string[];
  pos: number;
  flipped: boolean;
  /** One entry per rating made this session (an undone one is removed). */
  rated: { cardId: string; rating: Rating; firstTry: boolean }[];
  /** What the last rating changed, so Undo can put it back (only until the next card is shown). */
  undo: CardUndo | null;
  startedAt: string;
  /** Topics chosen, for "Drill these topics". */
  topicIds: string[];
}

/** Enough to reverse one rating. */
export interface CardUndo {
  reviewId: string;
  key: string;
  /** The state before the rating; null = the card was new. */
  prev: CardStateDoc | null;
  cram: boolean;
}

/** An in-progress drill. Not persisted: every answer is saved as an attempt as it happens. */
export interface DrillRun {
  sessionId: string;
  questionIds: string[];
  /** The live question: the furthest the drill has got. */
  index: number;
  answers: Record<string, string[]>;
  /** An earlier, answered question opened read-only (FR-16); null = showing the live one. */
  viewing?: number | null;
}

export interface AppState {
  packs: Pack[];
  ix: PackIndex | null;
  progress: ProgressDoc;
  flags: FlagsDoc;
  /** Flashcard progress: state per card + review log. */
  cards: CardsDoc;
  /** The card session in progress (not persisted; every rating is saved as it happens). */
  cardRun: CardRun | null;
  saveStatus: SaveStatus;
  storeKind: DataStore['kind'];
  recovered: string[];
  /** Saved data that couldn't be read; offered as a download. */
  setAside: SetAsideCopy[];
  drill: DrillRun | null;
  /** Some saved data came from a newer app version: it is left alone and she should update the app. */
  newerVersionData: boolean;
  /** Device-local values (label, last export, reminder snooze). Never synced. */
  meta: Meta;
  /** Whether the browser promised to keep this site's data. null until it has answered. */
  persistence: Persistence | null;
  shareEnv: ShareEnv;
  updates: UpdateSource;
  now: () => Date;
}

export interface AppActions {
  setDrill: (d: DrillRun | null) => void;
  startSession: (s: Omit<Session, 'id' | 'startedAt' | 'endedAt' | 'marked' | 'timeLimitMinutes'> & Partial<Pick<Session, 'marked' | 'timeLimitMinutes'>>) => string;
  endSession: (id: string, patch?: Partial<Session>) => void;
  recordAttempts: (attempts: Attempt[]) => void;
  updateProgress: (fn: (p: ProgressDoc) => ProgressDoc) => void;
  addFlag: (f: Omit<Flag, 'id' | 'createdAt' | 'updatedAt' | 'packId' | 'packVersion'>) => void;
  updateFlag: (id: string, patch: Partial<Pick<Flag, 'reason' | 'comment'>>) => void;
  removeFlag: (id: string) => void;
  importPack: (text: string) => Promise<{ ok: true; pack: Pack; replaced: number | null } | { ok: false; error: string }>;
  /** Replace: progress and flags become the file's (the caller confirms and saves a safety copy first). */
  restoreBackup: (b: Pick<SyncFile, 'progress' | 'flags'> & { cards?: CardsDoc }) => void;
  /** Merge: adds what the file has that this device doesn't (sync rules, see sync.ts). */
  mergeSyncFile: (b: Pick<SyncFile, 'progress' | 'flags'> & { cards?: CardsDoc }) => void;
  setActivePack: (packId: string) => void;
  setCardRun: (r: CardRun | null) => void;
  /** Rate a card: logs the review and (unless cramming) moves it between boxes. Returns what Undo needs. */
  rateCard: (a: { packId: string; cardId: string; rating: Rating; cram: boolean; examDate?: string }) => CardUndo;
  /** Undo the last rating: the review is removed (tombstoned) and the card's previous state restored. */
  undoRating: (u: CardUndo) => void;
  setNewCardsPerDay: (n: number) => void;
  setDeviceLabel: (label: string) => void;
  markExported: () => void;
  snoozeReminder: (until: string) => void;
}

const Ctx = createContext<(AppState & AppActions) | null>(null);

export function useApp(): AppState & AppActions {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}

export const newId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** How a change is saved. `system`: made by the app, not her (pre-flag seeding), so it doesn't count as newer. */
interface ChangeOptions {
  system?: boolean;
  replace?: boolean;
}

const defaultNow = () => new Date();

const withTimeout = <T,>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${what} took longer than ${Math.round(ms / 1000)} seconds.`)), ms))]);

interface Props {
  store: DataStore;
  bundledPacks: Pack[];
  /** Tests pass these to skip IndexedDB. */
  loadImported?: () => Promise<Pack[]>;
  saveImported?: (p: Pack) => Promise<void>;
  /** Device-local values (the raw store under `store`). Tests may omit it. */
  meta?: MetaStore;
  storageManager?: StorageManagerLike | null;
  shareEnv?: ShareEnv;
  updates?: UpdateSource;
  now?: () => Date;
  /** Give up loading after this long and show the error screen. */
  loadTimeoutMs?: number;
  children: ReactNode;
}

export function AppProvider({ store, bundledPacks, loadImported = loadImportedPacks, saveImported = saveImportedPack, meta: metaStore, storageManager = null, shareEnv, updates = noUpdates, now = defaultNow, loadTimeoutMs = 20_000, children }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [packs, setPacks] = useState<Pack[]>(bundledPacks);
  const [progress, setProgress] = useState<ProgressDoc | null>(null);
  const [flags, setFlags] = useState<FlagsDoc | null>(null);
  const [cards, setCards] = useState<CardsDoc>(emptyCards);
  const [cardRun, setCardRun] = useState<CardRun | null>(null);
  const [setAside, setSetAside] = useState<SetAsideCopy[]>([]);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [drill, setDrill] = useState<DrillRun | null>(null);
  const [meta, setMeta] = useState<Meta>({});
  const [persistence, setPersistence] = useState<Persistence | null>(null);
  const [share] = useState<ShareEnv>(() => shareEnv ?? browserShareEnv());
  const writes = useRef(Promise.resolve());
  // Latest docs, so actions fired in quick succession build on each other.
  const latest = useRef<{ progress: ProgressDoc | null; flags: FlagsDoc | null; cards: CardsDoc }>({ progress: null, flags: null, cards: emptyCards() });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [docs, imported, m] = await withTimeout(
          Promise.all([loadDocs(store), loadImported().catch(() => []), metaStore ? metaStore.readMeta().catch(() => ({}) as Meta) : ({} as Meta)]),
          loadTimeoutMs,
          'Loading your saved data',
        );
        if (!alive) return;
        latest.current = { progress: docs.progress, flags: docs.flags, cards: docs.cards };
        setCards(docs.cards);
        setProgress(docs.progress);
        setFlags(docs.flags);
        setSetAside(docs.setAside);
        setMeta(m);
        setPacks(choosePacks(bundledPacks, imported));
        setLoaded(true);
      } catch (e) {
        if (alive) setLoadError(e);
      }
    })();
    return () => {
      alive = false;
    };
  }, [store, bundledPacks, loadImported, loadTimeoutMs, metaStore]);

  /** Device-local values: update state now, save in the background (losing one is harmless). */
  const patchMeta = useCallback(
    (patch: Partial<Meta>) => {
      setMeta((m) => {
        const next: Record<string, unknown> = { ...m, ...patch };
        for (const [k, v] of Object.entries(next)) if (v === undefined) delete next[k];
        return next as Meta;
      });
      void metaStore?.writeMeta(patch).catch((e) => console.error('Saving device settings failed', e));
    },
    [metaStore],
  );

  // Ask the browser to keep this site's data (once per start, while not granted).
  useEffect(() => {
    if (!loaded) return;
    let alive = true;
    void requestPersistence(storageManager).then((p) => {
      if (!alive) return;
      setPersistence(p);
      if (p !== 'unknown') void metaStore?.writeMeta({ persisted: p === 'persistent' }).catch(() => undefined);
    });
    return () => {
      alive = false;
    };
  }, [loaded, storageManager, metaStore]);

  /** Write-through: update state now, persist in order. */
  const persist = useCallback(
    (doc: 'progress' | 'flags' | 'cards', data: ProgressDoc | FlagsDoc | CardsDoc, replace = false) => {
      setSaveStatus('saving');
      writes.current = writes.current
        .then(() => store.write(doc, data, { replace }))
        .then(
          () => setSaveStatus('saved'),
          () => setSaveStatus('error'),
        );
    },
    [store],
  );

  const updateProgress = useCallback(
    (fn: (p: ProgressDoc) => ProgressDoc, opts: ChangeOptions = {}) => {
      const prev = latest.current.progress!;
      const changed = fn(prev);
      // Her changes are stamped so the newer copy's settings and exam-in-progress win a merge.
      const next = opts.system ? changed : { ...changed, updatedAt: new Date().toISOString() };
      latest.current.progress = next;
      setProgress(next);
      persist('progress', next, opts.replace);
    },
    [persist],
  );

  const updateFlags = useCallback(
    (fn: (f: FlagsDoc) => FlagsDoc, opts: ChangeOptions = {}) => {
      const changed = fn(latest.current.flags!);
      const next = opts.system ? changed : { ...changed, updatedAt: new Date().toISOString() };
      latest.current.flags = next;
      setFlags(next);
      persist('flags', next, opts.replace);
    },
    [persist],
  );

  const updateCards = useCallback(
    (fn: (c: CardsDoc) => CardsDoc, opts: ChangeOptions = {}) => {
      const changed = fn(latest.current.cards);
      const next = opts.system ? changed : { ...changed, updatedAt: new Date().toISOString() };
      latest.current.cards = next;
      setCards(next);
      persist('cards', next, opts.replace);
    },
    [persist],
  );

  // Unconfirmed questions in any loaded pack show up as open flags (source "preflag");
  // uncommented pre-flags are dropped once a newer pack settles the question.
  // Both are the app's doing, not hers: they don't count as a newer copy, and a
  // dropped pre-flag gets a "" tombstone that loses to anything she changed.
  useEffect(() => {
    if (!loaded || !latest.current.flags) return;
    const sync = (d: FlagsDoc): FlagsDoc => {
      const pruned = prunePreflags(d.flags, packs) ?? d.flags;
      const gone = d.flags.filter((f) => !pruned.includes(f)).map((f) => ({ id: f.id, removedAt: '' }));
      return { ...d, flags: seedPreflags(pruned, packs) ?? pruned, removed: [...d.removed, ...gone] };
    };
    const current = latest.current.flags;
    if (!sameDoc(sync(current), current)) updateFlags(sync, { system: true });
  }, [loaded, packs, updateFlags]);

  const activePack = useMemo(() => {
    const id = progress?.settings.activePackId;
    return packs.find((p) => p.packId === id) ?? packs[0] ?? null;
  }, [packs, progress?.settings.activePackId]);
  const ix = useMemo(() => (activePack ? indexPack(activePack) : null), [activePack]);

  const actions: AppActions = useMemo(
    () => ({
      setDrill,
      updateProgress: (fn) => updateProgress(fn),
      startSession: (s) => {
        const id = newId(s.mode);
        updateProgress((p) => ({
          ...p,
          sessions: [...p.sessions, { marked: [], timeLimitMinutes: null, ...s, id, startedAt: new Date().toISOString(), endedAt: null }],
        }));
        return id;
      },
      endSession: (id, patch = {}) =>
        updateProgress((p) => ({
          ...p,
          sessions: p.sessions.map((s) => (s.id === id ? { ...s, endedAt: new Date().toISOString(), ...patch } : s)),
        })),
      recordAttempts: (attempts) => updateProgress((p) => ({ ...p, attempts: [...p.attempts, ...attempts] })),
      addFlag: (f) => {
        if (!ix) return;
        const now = new Date().toISOString();
        updateFlags((d) => ({
          ...d,
          flags: [...d.flags, { ...f, id: newId('flag'), createdAt: now, updatedAt: now, packId: ix.pack.packId, packVersion: ix.pack.version }],
        }));
      },
      updateFlag: (id, patch) => {
        const now = new Date().toISOString();
        updateFlags((d) => ({ ...d, flags: d.flags.map((f) => (f.id === id ? { ...f, ...patch, updatedAt: now } : f)) }));
      },
      removeFlag: (id) =>
        updateFlags((d) => ({ ...d, flags: d.flags.filter((f) => f.id !== id), removed: [...d.removed.filter((t) => t.id !== id), { id, removedAt: new Date().toISOString() }] })),
      importPack: async (text) => {
        let raw: unknown;
        try {
          raw = JSON.parse(text);
        } catch {
          return { ok: false, error: 'This file is not valid JSON, so it cannot be a content pack.' };
        }
        const r = parsePack(raw);
        if (!r.ok) return { ok: false, error: `This pack has problems and was not imported:\n${formatIssues(r.errors)}` };
        const current = packs.find((p) => p.packId === r.pack.packId);
        if (current && current.version > r.pack.version) {
          return { ok: false, error: `You already have a newer version of this pack (v${current.version}); this file is v${r.pack.version}.` };
        }
        if (current && current.version === r.pack.version) {
          // Same number, different questions: it would be silently swapped back on the next start.
          if (!sameDoc(current, r.pack)) {
            return { ok: false, error: `This file has the same version number (v${r.pack.version}) as the pack you already have, but different questions. Ask for a file with a new version number.` };
          }
          return { ok: false, error: `You already have this pack (v${r.pack.version}). Nothing to import.` };
        }
        await saveImported(r.pack);
        setPacks((ps) => choosePacks(ps.filter((p) => p.packId !== r.pack.packId), [r.pack]));
        return { ok: true, pack: r.pack, replaced: current ? current.version : null };
      },
      restoreBackup: (b) => {
        // Stamped, so an older copy of this device's data merged later only adds what came after the restore.
        const restoredAt = new Date().toISOString();
        updateProgress(() => ({ ...b.progress, restoredAt }), { replace: true });
        updateFlags(() => ({ ...b.flags, restoredAt }), { replace: true });
        updateCards(() => ({ ...(b.cards ?? emptyCards()), restoredAt }), { replace: true });
      },
      mergeSyncFile: (b) => {
        updateProgress((p) => mergeProgressForSync(p, b.progress));
        updateFlags((f) => mergeFlagsForSync(f, b.flags));
        if (b.cards) updateCards((c) => mergeCardsForSync(c, b.cards!));
      },
      setCardRun,
      rateCard: ({ packId, cardId, rating, cram, examDate }) => {
        const key = cardKey(packId, cardId);
        const at = now();
        const reviewId = newId('rev');
        const prev = latest.current.cards.states[key] ?? null;
        updateCards((c) => ({
          ...c,
          reviews: [...c.reviews, { id: reviewId, cardKey: key, rating, at: at.toISOString(), device: meta.deviceLabel ?? '', cram }],
          // A cram session never changes the schedule.
          states: cram ? c.states : { ...c.states, [key]: nextState(prev && !prev.fresh ? prev : undefined, rating, at, examDate) },
        }));
        return { reviewId, key, prev, cram };
      },
      undoRating: (u) => {
        const at = now().toISOString();
        updateCards((c) => {
          const states = { ...c.states };
          // Restore the previous state with a fresh stamp, so the undo wins a merge.
          // A card that was new goes back to "new" (fresh), rather than disappearing, for the same reason.
          if (!u.cram) states[u.key] = u.prev ? { ...u.prev, updatedAt: at } : { box: 1, dueDate: '0000-00-00', lastReviewedAt: '', updatedAt: at, fresh: true };
          return { ...c, states, reviews: c.reviews.filter((r) => r.id !== u.reviewId), undone: [...c.undone, { id: u.reviewId, at }] };
        });
      },
      setNewCardsPerDay: (n) => updateProgress((p) => ({ ...p, settings: { ...p.settings, newCardsPerDay: Math.max(0, Math.min(500, Math.round(n))) } })),
      setActivePack: (packId) => updateProgress((p) => ({ ...p, settings: { ...p.settings, activePackId: packId } })),
      setDeviceLabel: (label) => patchMeta({ deviceLabel: cleanLabel(label) || undefined }),
      markExported: () => patchMeta({ lastExportAt: now().toISOString(), reminderSnoozedUntil: undefined }),
      snoozeReminder: (until) => patchMeta({ reminderSnoozedUntil: until }),
    }),
    [ix, now, packs, patchMeta, saveImported, updateFlags, updateProgress, updateCards, meta.deviceLabel],
  );

  if (loadError) return <StartupError title="Your saved data couldn't be loaded" error={loadError} />;
  if (!loaded || !progress || !flags) return <div className="empty">Loading…</div>;

  const value = {
    packs,
    ix,
    progress,
    flags,
    cards,
    cardRun,
    saveStatus,
    storeKind: store.kind,
    recovered: [...new Set(setAside.map((c) => c.doc))],
    setAside,
    drill,
    newerVersionData: !!(store as { newerVersionData?: boolean }).newerVersionData,
    meta,
    persistence,
    shareEnv: share,
    updates,
    now,
    ...actions,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
