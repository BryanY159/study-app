import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flag, flagsDoc, prog } from '../../test/docHelpers';
import { MemoryDataStore } from './DataStore';
import { emptyProgress, legacyAttemptId, type ProgressDoc } from './docs';
import { IdbDataStore } from './IdbDataStore';
import { migrateLegacy } from './legacy';
import { loadDocs } from './load';
import { SafeStore } from './SafeStore';

// v1.4.1 kept docs in localStorage under "studyapp:". Shapes as v1.4.1 wrote them.
const v1Attempt = { questionId: 'q-alpha-0001', packId: 'sample-orrin', sessionId: 'd1', mode: 'drill' as const, chosen: ['A'], correct: true, at: '2026-11-09T10:00:00.000Z', ms: 900 };
const v141Progress = {
  ...emptyProgress(),
  updatedAt: '2026-11-10T00:00:00.000Z',
  attempts: [
    v1Attempt, // a v1 answer with no id (read with a legacy id)
    { id: 'att-2', questionId: 'q-alpha-0002', packId: 'sample-orrin', sessionId: 'd1', mode: 'drill', chosen: ['B'], correct: false, at: '2026-11-09T10:00:30.000Z', ms: 900 },
  ],
};
const v141Flags = flagsDoc('2026-11-10T00:00:00.000Z', [flag('u1', 'note')], [{ id: 'u0', removedAt: '2026-11-09T00:00:00.000Z' }]);

const seed = (progress: unknown = v141Progress, flags: unknown = v141Flags) => {
  localStorage.setItem('studyapp:progress', typeof progress === 'string' ? progress : JSON.stringify(progress));
  localStorage.setItem('studyapp:flags', typeof flags === 'string' ? flags : JSON.stringify(flags));
};
const snapshot = () => Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith('studyapp:')).map((k) => [k, localStorage.getItem(k)]));
const fixedNow = () => new Date('2026-11-17T12:00:00.000Z');

describe('moving pre-v1.5 localStorage data into IndexedDB', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('moves progress and flags unchanged (v1 answers get their legacy id) and records that it ran', async () => {
    seed();
    const raw = await IdbDataStore.open(new IDBFactory());
    const store = new SafeStore(raw);
    expect(await migrateLegacy(store, raw, localStorage, fixedNow)).toEqual({ ran: true, migrated: ['progress', 'flags'] });
    const docs = await loadDocs(store);
    expect(docs.progress.attempts.map((a) => a.id)).toEqual([legacyAttemptId(v1Attempt), 'att-2']);
    expect(docs.flags.flags.map((f) => f.comment)).toEqual(['note']);
    expect(docs.flags.removed).toEqual([{ id: 'u0', removedAt: '2026-11-09T00:00:00.000Z' }]);
    expect((await raw.readMeta()).legacyMigratedAt).toBe('2026-11-17T12:00:00.000Z');
  });

  it('runs once: a second start neither reads nor merges the old keys again', async () => {
    seed();
    const raw = new MemoryDataStore();
    const store = new SafeStore(raw);
    await migrateLegacy(store, raw, localStorage, fixedNow);
    // She restores an empty backup; the old keys still hold the answers.
    await store.write('progress', { ...emptyProgress(), restoredAt: '2026-11-18T00:00:00.000Z' }, { replace: true });
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    expect(await migrateLegacy(store, raw, localStorage, fixedNow)).toEqual({ ran: false, migrated: [] });
    expect(getItem).not.toHaveBeenCalled();
    expect(((await store.read('progress')) as ProgressDoc).attempts).toEqual([]);
  });

  it('merges with data IndexedDB already has: nothing is lost', async () => {
    seed();
    const raw = new MemoryDataStore();
    await raw.write('progress', prog('2026-11-12T00:00:00.000Z', ['n1']));
    await migrateLegacy(new SafeStore(raw), raw, localStorage, fixedNow);
    expect(((await raw.read('progress')) as ProgressDoc).attempts.map((a) => a.id).sort()).toEqual([legacyAttemptId(v1Attempt), 'att-2', 'n1'].sort());
  });

  it('corrupt progress is set aside and reported; flags still move', async () => {
    seed('{not json');
    const raw = new MemoryDataStore();
    const store = new SafeStore(raw);
    expect((await migrateLegacy(store, raw, localStorage, fixedNow)).migrated).toEqual(['flags']);
    expect([...raw.copies]).toEqual([[expect.stringMatching(/^progress\.corrupt-/), '{not json']]);
    const docs = await loadDocs(store);
    expect(docs.setAside).toMatchObject([{ doc: 'progress', where: 'legacy', text: '{not json' }]);
    expect(docs.flags.flags).toHaveLength(1);
  });

  it('data saved by a newer app version is not moved, and the app is told', async () => {
    seed({ schemaVersion: 2 });
    const raw = new MemoryDataStore();
    const store = new SafeStore(raw);
    expect((await migrateLegacy(store, raw, localStorage, fixedNow)).migrated).toEqual(['flags']);
    expect(await raw.read('progress')).toBeNull();
    expect(store.newerVersionData).toBe(true);
  });

  it('old set-aside copies come along', async () => {
    localStorage.setItem('studyapp:set-aside:flags.corrupt-2026-11-01T00-00-00-000Z.json', '{old broken');
    const raw = new MemoryDataStore();
    await migrateLegacy(new SafeStore(raw), raw, localStorage, fixedNow);
    expect(raw.copies.get('flags.corrupt-2026-11-01T00-00-00-000Z.json')).toBe('{old broken');
  });

  it('never writes or removes an old key: they stay byte-identical as a fallback', async () => {
    seed();
    localStorage.setItem('studyapp:set-aside:x.json', 'y');
    const before = snapshot();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
    const raw = new MemoryDataStore();
    const store = new SafeStore(raw);
    await migrateLegacy(store, raw, localStorage, fixedNow);
    await store.write('progress', prog('2026-11-18T00:00:00.000Z', ['later']));
    await store.write('flags', flagsDoc('2026-11-18T00:00:00.000Z', []), { replace: true });
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(snapshot()).toEqual(before);
  });

  it('with localStorage blocked (null) it still records that it ran', async () => {
    const raw = new MemoryDataStore();
    expect(await migrateLegacy(new SafeStore(raw), raw, null, fixedNow)).toEqual({ ran: true, migrated: [] });
    expect(raw.meta.legacyMigratedAt).toBeTruthy();
  });

  it('a failure part-way leaves the stamp unset, so it retries next start', async () => {
    seed();
    const raw = new MemoryDataStore();
    raw.write = async () => {
      throw new Error('disk full');
    };
    await expect(migrateLegacy(new SafeStore(raw), raw, localStorage, fixedNow)).rejects.toThrow('disk full');
    expect(raw.meta.legacyMigratedAt).toBeUndefined();
  });
});
