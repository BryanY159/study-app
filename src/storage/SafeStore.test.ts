import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { MemoryDataStore } from './DataStore';
import { flag, flagsDoc, prog } from '../../test/docHelpers';
import { emptyProgress, type FlagsDoc, type ProgressDoc } from './docs';
import { IdbDataStore, readRawData } from './IdbDataStore';
import { loadDocs } from './load';
import { SafeStore } from './SafeStore';

const ids = (d: unknown) => (d as ProgressDoc).attempts.map((a) => a.id).sort();

describe('IdbDataStore', () => {
  it('reads null for a fresh database, round-trips both docs, and survives reopening', async () => {
    const factory = new IDBFactory();
    const s = await IdbDataStore.open(factory);
    expect(await s.read('progress')).toBeNull();
    await s.write('progress', prog('t', ['a1']));
    await s.write('flags', flagsDoc('t', [flag('u1')]));
    s.close();
    const again = await IdbDataStore.open(factory);
    expect(await again.read('progress')).toEqual(prog('t', ['a1']));
    expect(((await again.read('flags')) as FlagsDoc).flags.map((f) => f.id)).toEqual(['u1']);
  });

  it('meta: read, merge a patch, remove a field with undefined', async () => {
    const s = await IdbDataStore.open(new IDBFactory());
    expect(await s.readMeta()).toEqual({});
    await s.writeMeta({ deviceLabel: 'Laptop', lastExportAt: '2026-11-01T00:00:00.000Z' });
    await s.writeMeta({ reminderSnoozedUntil: '2026-11-02T00:00:00.000Z' });
    await s.writeMeta({ lastExportAt: undefined });
    expect(await s.readMeta()).toEqual({ deviceLabel: 'Laptop', reminderSnoozedUntil: '2026-11-02T00:00:00.000Z' });
  });

  it('keeps at most 3 set-aside copies per doc, and no duplicates', async () => {
    const s = await IdbDataStore.open(new IDBFactory());
    for (let i = 0; i < 6; i++) await s.keepCopy(`progress.corrupt-2026-11-0${i}.json`, `bad ${i}`);
    await s.keepCopy('progress.corrupt-2026-11-09.json', 'bad 5');
    await s.keepCopy('flags.corrupt-2026-11-01.json', 'bad flags');
    const names = (await s.listCopies()).map((c) => c.name);
    expect(names).toEqual(['flags.corrupt-2026-11-01.json', 'progress.corrupt-2026-11-03.json', 'progress.corrupt-2026-11-04.json', 'progress.corrupt-2026-11-05.json']);
  });

  it('the rescue reader returns what the database holds, or null when it cannot open', async () => {
    const factory = new IDBFactory();
    const s = await IdbDataStore.open(factory);
    await s.write('progress', prog('t', ['a1']));
    s.close();
    expect(await readRawData(factory)).toMatchObject({ progress: prog('t', ['a1']), flags: null, copies: [] });
    const broken = { open: () => { throw new Error('blocked'); } } as unknown as IDBFactory;
    expect(await readRawData(broken)).toBeNull();
  });
});

describe('SafeStore', () => {
  const setup = () => {
    const inner = new MemoryDataStore();
    return { inner, safe: new SafeStore(inner) };
  };

  it('a stale write from memory merges instead of wiping newer saved answers', async () => {
    const { inner, safe } = setup();
    await inner.write('progress', prog('2026-11-05T00:00:00Z', ['a1', 'a2']));
    // The app still had an empty doc in memory and records one answer.
    await safe.write('progress', prog('2026-11-06T00:00:00Z', ['a9']));
    expect(ids(await inner.read('progress'))).toEqual(['a1', 'a2', 'a9']);
  });

  it('a restore (replace) replaces, and later writes build on it', async () => {
    const { inner, safe } = setup();
    await inner.write('progress', prog('2026-11-05T00:00:00Z', ['a1', 'a2']));
    await safe.write('progress', prog('2026-11-06T00:00:00Z', ['b1']), { replace: true });
    await safe.write('progress', prog('2026-11-06T00:00:01Z', ['b1', 'b2']));
    expect(ids(await inner.read('progress'))).toEqual(['b1', 'b2']);
  });

  it('a removed flag stays removed when a write still carries it', async () => {
    const { inner, safe } = setup();
    await inner.write('flags', flagsDoc('2026-11-04T00:00:00Z', [flag('u2')], [{ id: 'u1', removedAt: '2026-11-04T00:00:00Z' }]));
    await safe.write('flags', flagsDoc('2026-11-02T00:00:00Z', [flag('u1'), flag('u2')]));
    expect(((await inner.read('flags')) as FlagsDoc).flags.map((f) => f.id)).toEqual(['u2']);
  });

  it('an unreadable saved doc is set aside, never used, and a fresh doc starts', async () => {
    const { inner, safe } = setup();
    inner.docs.set('progress', JSON.stringify({ schemaVersion: 1, attempts: 'broken' }));
    const loaded = await loadDocs(safe);
    expect(loaded.progress).toEqual(emptyProgress());
    expect(loaded.recovered).toEqual(['progress']);
    expect([...inner.copies.keys()]).toEqual([expect.stringMatching(/^progress\.corrupt-/)]);
    await safe.write('progress', prog('t', ['a1']));
    expect(ids(await inner.read('progress'))).toEqual(['a1']);
  });

  it('I-2: a doc saved by a newer app version is never written over', async () => {
    const { inner, safe } = setup();
    const future = JSON.stringify({ schemaVersion: 2, flags: {} });
    inner.docs.set('flags', future);
    expect(await safe.read('flags')).toBeNull();
    await expect(safe.write('flags', flagsDoc('t', [flag('u1')]))).rejects.toThrow(/newer version/);
    await expect(safe.write('flags', flagsDoc('t', [flag('u1')]), { replace: true })).rejects.toThrow(/newer version/);
    expect(inner.docs.get('flags')).toBe(future);
    expect(safe.newerVersionData).toBe(true);
    expect(inner.copies.size).toBe(0);
  });

  it('refuses to save an invalid doc', async () => {
    const { safe } = setup();
    await expect(safe.write('progress', { schemaVersion: 1, attempts: 'x' })).rejects.toThrow(/Refusing/);
  });

  it('after close() (another tab took over) nothing more is saved', async () => {
    const { inner, safe } = setup();
    await safe.write('progress', prog('t1', ['a1']));
    safe.close();
    await expect(safe.write('progress', prog('t2', ['a1', 'a2']))).rejects.toThrow(/another tab/);
    expect(ids(await inner.read('progress'))).toEqual(['a1']);
  });

  it('on IndexedDB a save is one read-merge-write transaction; if the merge throws, nothing is written', async () => {
    const inner = await IdbDataStore.open(new IDBFactory());
    const update = vi.spyOn(inner, 'update');
    const read = vi.spyOn(inner, 'read');
    const safe = new SafeStore(inner);
    await safe.write('progress', prog('2026-11-06T00:00:00Z', ['a1']));
    expect(update).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalled();
    await expect(inner.update('progress', () => { throw new Error('merge failed'); })).rejects.toThrow('merge failed');
    expect(ids(await inner.read('progress'))).toEqual(['a1']);
  });

  it('a newer-version doc found during a save (IndexedDB) is left untouched', async () => {
    const inner = await IdbDataStore.open(new IDBFactory());
    await inner.write('flags', { schemaVersion: 2 });
    const safe = new SafeStore(inner);
    await expect(safe.write('flags', flagsDoc('t', [flag('u1')]), { replace: true })).rejects.toThrow(/newer version/);
    expect(await inner.read('flags')).toEqual({ schemaVersion: 2 });
    expect(safe.newerVersionData).toBe(true);
  });

  it('works the same on top of IndexedDB', async () => {
    const inner = await IdbDataStore.open(new IDBFactory());
    const safe = new SafeStore(inner);
    await inner.write('progress', prog('2026-11-05T00:00:00Z', ['a1']));
    await safe.write('progress', prog('2026-11-06T00:00:00Z', ['a2']));
    expect(ids(await inner.read('progress'))).toEqual(['a1', 'a2']);
  });
});
