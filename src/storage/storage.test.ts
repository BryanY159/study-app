import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makePack } from '../../test/makePack';
import { deliverFile, rescueBackup, type ShareEnv } from './backup';
import { MemoryDataStore } from './DataStore';
import { emptyCards, emptyFlags, emptyProgress } from './docs';
import { IdbDataStore } from './IdbDataStore';
import { loadDocs } from './load';
import { choosePacks, clearImportedPacks, loadImportedPacks, saveImportedPack } from './packStore';
import { parseSyncFile } from './syncFile';

describe('DataStore', () => {
  it('memory store round-trips docs and meta', async () => {
    const s = new MemoryDataStore();
    expect(await s.read('progress')).toBeNull();
    await s.write('progress', { a: 1 });
    expect(await s.read('progress')).toEqual({ a: 1 });
    await s.writeMeta({ deviceLabel: 'Phone' });
    await s.writeMeta({ deviceLabel: undefined, lastExportAt: 'x' });
    expect(await s.readMeta()).toEqual({ lastExportAt: 'x' });
  });

  it('loads empty docs on first run', async () => {
    const r = await loadDocs(new MemoryDataStore());
    expect(r).toEqual({ progress: emptyProgress(), flags: emptyFlags(), cards: emptyCards(), recovered: [], setAside: [] });
  });
});

describe('packStore', () => {
  beforeEach(() => clearImportedPacks());

  it('saves and replaces imported packs by packId', async () => {
    const v1 = makePack({ a: 2 });
    await saveImportedPack(v1);
    await saveImportedPack({ ...v1, version: 2 });
    const packs = await loadImportedPacks();
    expect(packs).toHaveLength(1);
    expect(packs[0].version).toBe(2);
  });

  it('chooses the highest version per packId', () => {
    const a1 = makePack({ a: 1 });
    const a3 = { ...a1, version: 3 };
    const b = { ...makePack({ b: 1 }), packId: 'sample-orrin' };
    expect(choosePacks([a1, b], [a3]).map((p) => [p.packId, p.version])).toEqual([
      ['test-pack', 3],
      ['sample-orrin', 1],
    ]);
    expect(choosePacks([a3], [a1])[0].version).toBe(3);
  });
});

describe('rescue file (error screens)', () => {
  beforeEach(() => localStorage.clear());

  it('is an importable sync file from IndexedDB, plus every raw entry', async () => {
    const factory = new IDBFactory();
    const s = await IdbDataStore.open(factory);
    const p = emptyProgress();
    p.settings.hideFlagged = true;
    await s.write('progress', p);
    await s.keepCopy('flags.corrupt-x.json', '{broken');
    s.close();
    localStorage.setItem('studyapp:flags', '{also broken');
    const text = await rescueBackup(new Date('2026-11-05T00:00:00Z'), factory, localStorage);
    const r = parseSyncFile(text);
    expect(r.ok && r.file.progress.settings.hideFlagged).toBe(true);
    const raw = JSON.parse(text).raw;
    expect(raw.indexedDB.setAside).toEqual([{ name: 'flags.corrupt-x.json', text: '{broken' }]);
    expect(raw.localStorage['studyapp:flags']).toBe('{also broken');
  });

  it('falls back to the pre-v1.5 localStorage copy when IndexedDB is blocked', async () => {
    const blocked = { open: () => { throw new Error('blocked'); } } as unknown as IDBFactory;
    localStorage.setItem('studyapp:progress', JSON.stringify({ ...emptyProgress(), settings: { hideFlagged: true, activePackId: null } }));
    const text = await rescueBackup(new Date(), blocked, localStorage);
    const r = parseSyncFile(text);
    expect(r.ok && r.file.progress.settings.hideFlagged).toBe(true);
    expect(JSON.parse(text).raw.indexedDB).toBe('could not be opened');
  });
});

describe('deliverFile (Share sheet or download)', () => {
  let downloads: string[] = [];
  beforeEach(() => {
    downloads = [];
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
  });
  afterEach(() => vi.restoreAllMocks());

  const env = (over: Partial<ShareEnv> = {}): ShareEnv & { shared: File[][] } => {
    const shared: File[][] = [];
    return { touch: true, canShare: () => true, share: async (d) => void shared.push(d.files), shared, ...over };
  };

  it('opens the Share sheet on a touch device that can share files', async () => {
    const e = env();
    expect(await deliverFile('a.json', '{}', e)).toBe('shared');
    expect(e.shared[0][0].name).toBe('a.json');
    expect(downloads).toEqual([]);
  });

  it('downloads on desktop, even where sharing exists', async () => {
    const e = env({ touch: false });
    expect(await deliverFile('a.json', '{}', e)).toBe('downloaded');
    expect(e.shared).toEqual([]);
    expect(downloads).toEqual(['a.json']);
  });

  it('a cancelled Share sheet is not an export and does not download', async () => {
    const e = env({ share: async () => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' })) });
    expect(await deliverFile('a.json', '{}', e)).toBe('cancelled');
    expect(downloads).toEqual([]);
  });

  it('a share that fails for another reason falls back to a download', async () => {
    const e = env({ share: async () => Promise.reject(new Error('NotAllowed')) });
    expect(await deliverFile('a.json', '{}', e)).toBe('downloaded');
    expect(downloads).toEqual(['a.json']);
  });

  it('downloads when files cannot be shared', async () => {
    expect(await deliverFile('a.json', '{}', env({ canShare: () => false }))).toBe('downloaded');
  });
});
