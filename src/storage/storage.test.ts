import { beforeEach, describe, expect, it } from 'vitest';
import { makePack } from '../../test/makePack';
import { emergencyBackup, makeBackup, parseBackup } from './backup';
import { BrowserDataStore, listBrowserCopies, MemoryDataStore, STORAGE_PREFIX } from './DataStore';
import { emptyFlags, emptyProgress } from './docs';
import { loadDocs } from './load';
import { choosePacks, clearImportedPacks, loadImportedPacks, saveImportedPack } from './packStore';

describe('DataStore', () => {
  beforeEach(() => localStorage.clear());

  it('memory store round-trips', async () => {
    const s = new MemoryDataStore();
    expect(await s.read('progress')).toBeNull();
    await s.write('progress', { a: 1 });
    expect(await s.read('progress')).toEqual({ a: 1 });
  });

  it('browser store writes under studyapp: keys', async () => {
    const s = new BrowserDataStore();
    await s.write('flags', emptyFlags());
    expect(localStorage.getItem(`${STORAGE_PREFIX}flags`)).toContain('schemaVersion');
    expect(await s.read('flags')).toEqual(emptyFlags());
  });

  it('loads empty docs on first run', async () => {
    const r = await loadDocs(new BrowserDataStore());
    expect(r).toEqual({ progress: emptyProgress(), flags: emptyFlags(), recovered: [], setAside: [] });
  });

  it('keeps a copy of corrupt data instead of losing it', async () => {
    localStorage.setItem(`${STORAGE_PREFIX}progress`, '{not json');
    localStorage.setItem(`${STORAGE_PREFIX}flags`, JSON.stringify({ schemaVersion: 99 }));
    const r = await loadDocs(new BrowserDataStore());
    expect(r.recovered).toEqual(['progress', 'flags']);
    expect(r.progress).toEqual(emptyProgress());
    const copies = listBrowserCopies(localStorage);
    expect(copies.map((c) => c.name)).toEqual([expect.stringMatching(/^flags.corrupt-/), expect.stringMatching(/^progress.corrupt-/)]);
    expect(copies.find((c) => c.name.startsWith('progress'))!.text).toBe('{not json');
    expect(r.setAside.map((c) => c.doc)).toEqual(['progress', 'flags']);
  });

  it('keeps at most 3 set-aside copies per doc, and no duplicates', async () => {
    const s = new BrowserDataStore();
    for (let i = 0; i < 6; i++) await s.keepCopy(`progress.corrupt-2026-11-0${i}.json`, `bad ${i}`);
    await s.keepCopy('progress.corrupt-2026-11-09.json', 'bad 5');
    expect(listBrowserCopies(localStorage).map((c) => c.text)).toEqual(['bad 3', 'bad 4', 'bad 5']);
  });

  it('emergency backup is a restorable backup plus the raw entries', () => {
    localStorage.setItem(`${STORAGE_PREFIX}progress`, JSON.stringify(emptyProgress()));
    localStorage.setItem(`${STORAGE_PREFIX}flags`, '{broken');
    const text = emergencyBackup(localStorage);
    expect(parseBackup(text).ok).toBe(true);
    expect(JSON.parse(text).raw[`${STORAGE_PREFIX}flags`]).toBe('{broken');
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

describe('backup', () => {
  it('round-trips', () => {
    const p = emptyProgress();
    p.settings.hideFlagged = true;
    const text = JSON.stringify(makeBackup(p, emptyFlags(), new Date('2026-11-05T00:00:00Z')));
    const r = parseBackup(text);
    expect(r.ok && r.backup.progress.settings.hideFlagged).toBe(true);
  });

  it('rejects non-backups with a readable error', () => {
    expect(parseBackup('nope')).toEqual({ ok: false, error: expect.stringMatching(/not valid JSON/) });
    expect(parseBackup('{"a":1}')).toEqual({ ok: false, error: expect.stringMatching(/not a Study app backup/) });
  });
});
