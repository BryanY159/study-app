import type { DocName } from './DataStore';
import { FlagsDocSchema, ProgressDocSchema, type Flag, type FlagsDoc, type ProgressDoc, type Session, type Tombstone } from './docs';

// Merging two copies of a doc (browser and data folder, or a stale in-memory
// copy and what's saved). Nothing she did is dropped:
//   progress: attempts are append-only (union by id), sessions union by id
//             (a finished session beats an unfinished one); settings and
//             activeMock come from the copy with the newer updatedAt.
//   flags:    union by id, the newer per-flag updatedAt wins; removals are
//             tombstones so a merge with an older copy doesn't bring them back.
// A restore from backup is a deliberate replacement: it stamps restoredAt, and a
// copy restored earlier (or never) only contributes what happened after that.

const byAt = <T extends { at: string }>(xs: T[]) => [...xs].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

/** Order a, b so the first has the newer doc stamp (ties: a). */
const newerFirst = <T extends { updatedAt: string }>(a: T, b: T): [T, T] => (b.updatedAt > a.updatedAt ? [b, a] : [a, b]);

/** The later restoredAt of two docs. */
const lastRestore = (a: { restoredAt: string }, b: { restoredAt: string }) => (a.restoredAt > b.restoredAt ? a.restoredAt : b.restoredAt);

/** What a copy still contributes after a restore at r: only what happened after it. */
function sinceRestore(d: ProgressDoc, r: string): ProgressDoc {
  if (d.restoredAt >= r) return d;
  return {
    ...d,
    attempts: d.attempts.filter((x) => x.at > r),
    sessions: d.sessions.filter((x) => x.startedAt > r),
    activeMock: d.activeMock && d.activeMock.startedAt > r ? d.activeMock : null,
  };
}

function flagsSinceRestore(d: FlagsDoc, r: string): FlagsDoc {
  if (d.restoredAt >= r) return d;
  return { ...d, flags: d.flags.filter((f) => f.createdAt > r || f.updatedAt > r), removed: d.removed.filter((t) => t.removedAt > r) };
}

export function mergeProgress(x: ProgressDoc, y: ProgressDoc): ProgressDoc {
  const restoredAt = lastRestore(x, y);
  const [newer, older] = newerFirst(sinceRestore(x, restoredAt), sinceRestore(y, restoredAt));
  const attempts = new Map(older.attempts.map((x) => [x.id, x]));
  for (const x of newer.attempts) attempts.set(x.id, x);

  const sessions = new Map<string, Session>();
  for (const s of [...older.sessions, ...newer.sessions]) {
    const cur = sessions.get(s.id);
    // A finished session keeps its end (and marks) even if the other copy is newer overall.
    sessions.set(s.id, cur && cur.endedAt && !s.endedAt ? cur : s);
  }

  // The newer copy's exam in progress. If the newer copy never saw the older copy's exam, keep that one.
  let activeMock = newer.activeMock;
  if (!activeMock && older.activeMock && !newer.sessions.some((s) => s.id === older.activeMock!.sessionId)) activeMock = older.activeMock;
  if (activeMock && sessions.get(activeMock.sessionId)?.endedAt) activeMock = null;

  return {
    ...newer,
    restoredAt,
    attempts: byAt([...attempts.values()]),
    sessions: [...sessions.values()].sort((x, y) => (x.startedAt < y.startedAt ? -1 : x.startedAt > y.startedAt ? 1 : 0)),
    activeMock,
  };
}

export function mergeFlags(x: FlagsDoc, y: FlagsDoc): FlagsDoc {
  const restoredAt = lastRestore(x, y);
  const [newer, older] = newerFirst(flagsSinceRestore(x, restoredAt), flagsSinceRestore(y, restoredAt));
  const removed = new Map<string, Tombstone>();
  for (const t of [...older.removed, ...newer.removed]) {
    const cur = removed.get(t.id);
    if (!cur || t.removedAt > cur.removedAt) removed.set(t.id, t);
  }
  const flags = new Map<string, Flag>();
  // Newer doc last, so it wins ties, except that a copy she edited (has a comment) always beats an
  // untouched one with the same stamp: flags saved before v1.4 and freshly seeded pre-flags both have "".
  const edited = (f: Flag) => (f.comment.trim() ? 1 : 0);
  for (const f of [...older.flags, ...newer.flags]) {
    const cur = flags.get(f.id);
    if (!cur || f.updatedAt > cur.updatedAt || (f.updatedAt === cur.updatedAt && edited(f) >= edited(cur))) flags.set(f.id, f);
  }
  // A flag survives a removal only if she changed it after removing it.
  const kept = [...flags.values()].filter((f) => {
    const t = removed.get(f.id);
    return !t || f.updatedAt > t.removedAt;
  });
  kept.sort((x, y) => (x.createdAt < y.createdAt ? -1 : x.createdAt > y.createdAt ? 1 : 0));
  return { ...newer, restoredAt, flags: kept, removed: [...removed.values()] };
}

/** Validates and merges the two persisted docs. SafeStore uses it on every read and write. */
export interface DocCodec {
  /** The doc if it's valid, else why not. */
  parse(doc: DocName, raw: unknown): { ok: true; value: unknown } | { ok: false; reason: string; newerVersion?: boolean };
  merge(doc: DocName, a: unknown, b: unknown): unknown;
}

export const docCodec: DocCodec = {
  parse(doc, raw) {
    if (raw && typeof raw === 'object' && '__unparseable' in raw) return { ok: false, reason: 'the file is not valid JSON' };
    const version = (raw as { schemaVersion?: unknown } | null)?.schemaVersion;
    if (typeof version === 'number' && version > 1) return { ok: false, reason: 'it was saved by a newer version of the app', newerVersion: true };
    const r = (doc === 'progress' ? ProgressDocSchema : FlagsDocSchema).safeParse(raw);
    return r.success ? { ok: true, value: r.data } : { ok: false, reason: 'it is not in the expected format' };
  },
  merge(doc, a, b) {
    return doc === 'progress' ? mergeProgress(a as ProgressDoc, b as ProgressDoc) : mergeFlags(a as FlagsDoc, b as FlagsDoc);
  },
};

export const sameDoc = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

// --- Sync import (a file from ANOTHER device) ---------------------------------
// Same ID-based merge as above, with two deliberate differences (plan D2):
//   1. restoredAt is not applied across devices. It exists so an older copy of
//      THIS device's data can't undo a restore; applied to another device's file
//      it would silently drop that device's (or this one's) older answers.
//      Both sides are merged in full, and this device keeps its own restoredAt.
//   2. Device-local fields stay local: settings and the exam in progress always
//      come from this device, even if the file is newer.
// Tombstones still apply: a flag removed on one device stays removed.
// Pure and idempotent: merging the same file twice gives the same docs.

export function mergeProgressForSync(local: ProgressDoc, incoming: ProgressDoc): ProgressDoc {
  const merged = mergeProgress({ ...local, restoredAt: '' }, { ...incoming, restoredAt: '' });
  return { ...merged, schemaVersion: local.schemaVersion, updatedAt: local.updatedAt, restoredAt: local.restoredAt, settings: local.settings, activeMock: local.activeMock };
}

export function mergeFlagsForSync(local: FlagsDoc, incoming: FlagsDoc): FlagsDoc {
  const merged = mergeFlags({ ...local, restoredAt: '' }, { ...incoming, restoredAt: '' });
  return { ...merged, schemaVersion: local.schemaVersion, updatedAt: local.updatedAt, restoredAt: local.restoredAt };
}

export interface MergePreview {
  answers: number;
  sessions: number;
  flagsAdded: number;
  flagsUpdated: number;
  flagsRemoved: number;
}

export const nothingNew = (p: MergePreview): boolean => Object.values(p).every((n) => n === 0);

/** What a sync Merge would change on this device, worked out before anything is written. */
export function previewMerge(local: { progress: ProgressDoc; flags: FlagsDoc }, incoming: { progress: ProgressDoc; flags: FlagsDoc }): MergePreview {
  const p = mergeProgressForSync(local.progress, incoming.progress);
  const f = mergeFlagsForSync(local.flags, incoming.flags);
  const attemptIds = new Set(local.progress.attempts.map((a) => a.id));
  const sessionIds = new Set(local.progress.sessions.map((s) => s.id));
  const localFlags = new Map(local.flags.flags.map((x) => [x.id, x]));
  const mergedIds = new Set(f.flags.map((x) => x.id));
  return {
    answers: p.attempts.filter((a) => !attemptIds.has(a.id)).length,
    sessions: p.sessions.filter((s) => !sessionIds.has(s.id)).length,
    flagsAdded: f.flags.filter((x) => !localFlags.has(x.id)).length,
    flagsUpdated: f.flags.filter((x) => localFlags.has(x.id) && !sameDoc(x, localFlags.get(x.id))).length,
    flagsRemoved: local.flags.flags.filter((x) => !mergedIds.has(x.id)).length,
  };
}
