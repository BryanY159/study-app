import { describe, expect, it } from 'vitest';
import { FakeDir } from '../../test/fakeFs';
import { MemoryDataStore } from './DataStore';
import { emptyFlags, emptyProgress, type Attempt, type Flag, type FlagsDoc, type ProgressDoc } from './docs';
import { FolderConnection, type FolderDeps } from './folderConnection';
import { FsAccessDataStore } from './FsAccessDataStore';
import { MirroredDataStore, type MirrorStatus } from './MirroredDataStore';

const fast = { retryDelays: [1, 1, 1] };

const att = (id: string): Attempt => ({
  id,
  questionId: 'q-a-0001',
  packId: 'test-pack',
  sessionId: 's1',
  mode: 'drill',
  chosen: ['A'],
  correct: true,
  at: `2026-11-01T00:00:${String(Number(id.replace(/\D/g, '')) % 60).padStart(2, '0')}.000Z`,
  ms: 1000,
});
const prog = (updatedAt: string, attemptIds: string[] = []): ProgressDoc => ({ ...emptyProgress(), updatedAt, attempts: attemptIds.map(att) });
const flag = (id: string, comment = '', updatedAt = '2026-11-02T00:00:00.000Z', source: Flag['source'] = 'user'): Flag => ({
  id,
  packId: 'test-pack',
  packVersion: 1,
  questionId: `q-a-000${id.slice(-1)}`,
  reason: 'answer-wrong',
  comment,
  mode: 'review',
  source,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt,
});
const flagsDoc = (updatedAt: string, flags: Flag[], removed: FlagsDoc['removed'] = []): FlagsDoc => ({ ...emptyFlags(), updatedAt, flags, removed });
const ids = (d: { attempts: { id: string }[] }) => d.attempts.map((a) => a.id).sort();

function setup() {
  const browser = new MemoryDataStore();
  const mirror = new MirroredDataStore(browser, fast);
  const statuses: MirrorStatus['kind'][] = [];
  mirror.subscribe((s) => statuses.push(s.kind));
  return { browser, mirror, statuses };
}

describe('FsAccessDataStore', () => {
  it('reads null for a fresh folder and round-trips JSON', async () => {
    const dir = new FakeDir();
    const s = new FsAccessDataStore(dir);
    expect(await s.read('progress')).toBeNull();
    await s.write('progress', prog('t', ['a1']));
    expect(dir.json('progress.json')).toEqual(prog('t', ['a1']));
    expect(await s.read('progress')).toEqual(prog('t', ['a1']));
  });
});

describe('MirroredDataStore', () => {
  it('writes to the browser immediately and to the folder through the queue', async () => {
    const { browser, mirror } = setup();
    const dir = new FakeDir();
    await mirror.attach(new FsAccessDataStore(dir));
    await mirror.write('progress', prog('t1', ['a1']));
    expect(ids((await browser.read('progress')) as ProgressDoc)).toEqual(['a1']);
    await mirror.flush();
    expect(ids(dir.json('progress.json'))).toEqual(['a1']);
    expect(mirror.getStatus().kind).toBe('folder');
  });

  it('coalesces rapid writes: the folder ends with the latest and skips stale versions', async () => {
    const { mirror } = setup();
    const dir = new FakeDir();
    await mirror.attach(new FsAccessDataStore(dir));
    const all: string[] = [];
    for (let i = 1; i <= 20; i++) {
      all.push(`a${i}`);
      await mirror.write('progress', prog(`t${String(i).padStart(2, '0')}`, all));
    }
    await mirror.flush();
    expect(dir.json('progress.json').attempts).toHaveLength(20);
    expect(dir.writes).toBeLessThan(20);
  });

  it('on attach, merges both copies: answers from each side end up in both', async () => {
    const { browser, mirror } = setup();
    const dir = new FakeDir();
    await browser.write('progress', prog('2026-11-06T00:00:00Z', ['a3']));
    dir.files.set('progress.json', JSON.stringify(prog('2026-11-05T00:00:00Z', ['a1', 'a2'])));
    const changed = await mirror.attach(new FsAccessDataStore(dir));
    expect(changed).toEqual(['progress']);
    expect(ids((await browser.read('progress')) as ProgressDoc)).toEqual(['a1', 'a2', 'a3']);
    expect(ids(dir.json('progress.json'))).toEqual(['a1', 'a2', 'a3']);
  });

  it('on attach, browser-only v1 progress (no stamps, no attempt ids) moves into an empty folder', async () => {
    const { browser, mirror } = setup();
    const dir = new FakeDir();
    const { id: _, ...legacy } = att('a1');
    await browser.write('progress', { schemaVersion: 1, attempts: [legacy], sessions: [], activeMock: null, settings: { hideFlagged: false } });
    await mirror.attach(new FsAccessDataStore(dir));
    expect(dir.json('progress.json').attempts).toEqual([{ ...legacy, id: `s1|q-a-0001|${legacy.at}` }]);
  });

  it('C-1: a cleared browser connecting to a folder with flags keeps every flag and comment', async () => {
    const { browser, mirror } = setup();
    const dir = new FakeDir();
    const folderFlags = [
      flag('u1', 'B is right'),
      flag('u2', 'typo in C'),
      flag('u3'),
      flag('preflag-test-pack-q-a-0004', 'asked the TA', '2026-11-03T00:00:00Z', 'preflag'),
      flag('preflag-test-pack-q-a-0005', '', '', 'preflag'),
    ];
    dir.files.set('flags.json', JSON.stringify(flagsDoc('2026-11-03T00:00:00Z', folderFlags)));
    // The fresh browser seeded the two pre-flags (an app change: no stamps) before she connected.
    const seeded = [flag('preflag-test-pack-q-a-0004', '', '', 'preflag'), flag('preflag-test-pack-q-a-0005', '', '', 'preflag')];
    await mirror.write('flags', flagsDoc('', seeded.map((f) => ({ ...f, createdAt: '2026-11-07T00:00:00Z' }))));
    await mirror.attach(new FsAccessDataStore(dir));
    for (const d of [dir.json('flags.json') as FlagsDoc, (await browser.read('flags')) as FlagsDoc]) {
      expect(d.flags.map((f) => f.id).sort()).toEqual(folderFlags.map((f) => f.id).sort());
      expect(d.flags.find((f) => f.id === 'preflag-test-pack-q-a-0004')!.comment).toBe('asked the TA');
      expect(d.flags.find((f) => f.id === 'u1')!.comment).toBe('B is right');
    }
  });

  it('N-1: a v1.3 pre-flag comment survives Skip + a flag edit in a fresh browser, then connect', async () => {
    const { browser, mirror } = setup();
    const dir = new FakeDir();
    // data/flags.json as v1.3 saved it: no per-flag updatedAt.
    const { updatedAt: _u, ...v13 } = flag('preflag-test-pack-q-a-0004', 'TA says C is right', '', 'preflag');
    dir.files.set('flags.json', JSON.stringify({ schemaVersion: 1, updatedAt: '2026-11-03T00:00:00.000Z', flags: [v13] }));
    // Fresh browser, "Skip for now": the app seeds the empty pre-flag (system change)...
    await mirror.write('flags', flagsDoc('', [{ ...flag('preflag-test-pack-q-a-0004', '', '', 'preflag'), createdAt: '2026-11-07T00:00:00Z' }]));
    // ...then she flags another question, which stamps the browser doc as newer.
    const seeded = ((await browser.read('flags')) as FlagsDoc).flags;
    await mirror.write('flags', flagsDoc('2026-11-07T00:01:00Z', [...seeded, flag('u9', '', '2026-11-07T00:01:00Z')]));
    await mirror.attach(new FsAccessDataStore(dir));
    for (const d of [dir.json('flags.json') as FlagsDoc, (await browser.read('flags')) as FlagsDoc]) {
      expect(d.flags.find((f) => f.id === 'preflag-test-pack-q-a-0004')!.comment).toBe('TA says C is right');
      expect(d.flags.map((f) => f.id).sort()).toEqual(['preflag-test-pack-q-a-0004', 'u9']);
    }
  });

  it('a removed flag stays removed when the other copy still has it', async () => {
    const { browser, mirror } = setup();
    const dir = new FakeDir();
    dir.files.set('flags.json', JSON.stringify(flagsDoc('2026-11-02T00:00:00Z', [flag('u1'), flag('u2')])));
    await browser.write('flags', flagsDoc('2026-11-04T00:00:00Z', [flag('u2')], [{ id: 'u1', removedAt: '2026-11-04T00:00:00Z' }]));
    await mirror.attach(new FsAccessDataStore(dir));
    expect((dir.json('flags.json') as FlagsDoc).flags.map((f) => f.id)).toEqual(['u2']);
    expect(((await browser.read('flags')) as FlagsDoc).flags.map((f) => f.id)).toEqual(['u2']);
  });

  it('a stale write from memory merges instead of wiping newer saved answers', async () => {
    const { browser, mirror } = setup();
    const dir = new FakeDir();
    dir.files.set('progress.json', JSON.stringify(prog('2026-11-05T00:00:00Z', ['a1', 'a2'])));
    await mirror.attach(new FsAccessDataStore(dir));
    // The app still had an empty doc in memory and records one answer.
    await mirror.write('progress', prog('2026-11-06T00:00:00Z', ['a9']));
    await mirror.flush();
    expect(ids(dir.json('progress.json'))).toEqual(['a1', 'a2', 'a9']);
    expect(ids((await browser.read('progress')) as ProgressDoc)).toEqual(['a1', 'a2', 'a9']);
  });

  it('a restore (replace) replaces both copies, and later writes build on it', async () => {
    const { browser, mirror } = setup();
    const dir = new FakeDir();
    dir.files.set('progress.json', JSON.stringify(prog('2026-11-05T00:00:00Z', ['a1', 'a2'])));
    await mirror.attach(new FsAccessDataStore(dir));
    await mirror.write('progress', prog('2026-11-06T00:00:00Z', ['b1']), { replace: true });
    await mirror.write('progress', prog('2026-11-06T00:00:01Z', ['b1', 'b2']));
    await mirror.flush();
    expect(ids(dir.json('progress.json'))).toEqual(['b1', 'b2']);
    expect(ids((await browser.read('progress')) as ProgressDoc)).toEqual(['b1', 'b2']);
  });

  it('N-3: a restore made while the folder is disconnected replaces the folder copy on reconnect (even after a reload)', async () => {
    const dir = new FakeDir();
    dir.files.set('progress.json', JSON.stringify(prog('2026-11-05T00:00:00Z', ['a1', 'a2'])));
    dir.files.set('flags.json', JSON.stringify(flagsDoc('2026-11-05T00:00:00Z', [flag('u1'), flag('u2')])));
    const browser = new MemoryDataStore();
    const first = new MirroredDataStore(browser, fast);
    // Not connected (needs-permission): she restores a backup with one answer and no flags.
    const r = '2026-11-06T00:00:00.000Z';
    await first.write('progress', { ...prog(r, ['b1']), restoredAt: r }, { replace: true });
    await first.write('flags', { ...flagsDoc(r, []), restoredAt: r }, { replace: true });

    // Next day, new page load, she reconnects.
    const second = new MirroredDataStore(browser, fast);
    await second.attach(new FsAccessDataStore(dir));
    expect(ids(dir.json('progress.json'))).toEqual(['b1']);
    expect((dir.json('flags.json') as FlagsDoc).flags).toEqual([]);
    expect(ids((await browser.read('progress')) as ProgressDoc)).toEqual(['b1']);
  });

  it('read() merges and repairs both sides', async () => {
    const { browser, mirror } = setup();
    const dir = new FakeDir();
    await mirror.attach(new FsAccessDataStore(dir));
    dir.files.set('progress.json', JSON.stringify(prog('2026-11-06T00:00:00Z', ['a1'])));
    await browser.write('progress', prog('2026-11-01T00:00:00Z', ['a2']));
    expect(ids((await mirror.read('progress')) as ProgressDoc)).toEqual(['a1', 'a2']);
    expect(ids((await browser.read('progress')) as ProgressDoc)).toEqual(['a1', 'a2']);
    expect(ids(dir.json('progress.json'))).toEqual(['a1', 'a2']);
  });

  it('an unreadable folder file is never used: a copy is kept and the browser data is saved', async () => {
    const { browser, mirror } = setup();
    const dir = new FakeDir();
    const broken = '{"schemaVersion":1,"attempts":[{broken';
    dir.files.set('progress.json', broken);
    await browser.write('progress', prog('2026-11-01T00:00:00Z', ['a1']));
    await mirror.attach(new FsAccessDataStore(dir));
    const copies = [...dir.files.keys()].filter((k) => /^progress\.corrupt-.*\.json$/.test(k));
    expect(copies).toHaveLength(1);
    expect(dir.files.get(copies[0])).toBe(broken);
    expect(ids(dir.json('progress.json'))).toEqual(['a1']);
    expect(mirror.takeSetAside()).toMatchObject([{ doc: 'progress', where: 'folder', name: copies[0], text: broken }]);
  });

  it('I-2: data from a newer app version is never written over; the folder is dropped (browser only)', async () => {
    const { browser, mirror } = setup();
    const dir = new FakeDir();
    const future = JSON.stringify({ schemaVersion: 2, updatedAt: '2026-12-01T00:00:00Z', answers: [] });
    dir.files.set('progress.json', future);
    dir.files.set('flags.json', JSON.stringify(flagsDoc('t', [flag('u1')])));
    await browser.write('progress', prog('2026-11-01T00:00:00Z', ['a1', 'a2']));
    await mirror.attach(new FsAccessDataStore(dir));
    expect(mirror.connected).toBe(false);
    expect(mirror.getStatus().kind).toBe('newer-version');
    expect(mirror.newerVersionData).toBe(true);
    // Keeps saving in the browser; no folder file is touched, and no copies are made.
    await mirror.write('progress', prog('2026-11-02T00:00:00Z', ['a1', 'a2', 'a3']));
    await mirror.flush();
    expect(dir.files.get('progress.json')).toBe(future);
    expect(dir.writes).toBe(0);
    expect([...dir.files.keys()].sort()).toEqual(['flags.json', 'progress.json']);
    expect(ids((await browser.read('progress')) as ProgressDoc)).toEqual(['a1', 'a2', 'a3']);
  });

  it('I-2: a browser copy from a newer app version is never written over either', async () => {
    const browser = new MemoryDataStore();
    const mirror = new MirroredDataStore(browser, fast);
    const future = JSON.stringify({ schemaVersion: 2, flags: {} });
    browser.docs.set('flags', future);
    expect(await mirror.read('flags')).toBeNull();
    await expect(mirror.write('flags', flagsDoc('t', [flag('u1')]))).rejects.toThrow(/newer version/);
    expect(browser.docs.get('flags')).toBe(future);
    expect(mirror.newerVersionData).toBe(true);
  });

  it('an unreadable browser copy is set aside in the browser and the folder copy is used', async () => {
    const browser = new MemoryDataStore();
    const mirror = new MirroredDataStore(browser, fast);
    browser.docs.set('flags', JSON.stringify({ schemaVersion: 1, flags: 'nope' }));
    const dir = new FakeDir();
    dir.files.set('flags.json', JSON.stringify(flagsDoc('t', [flag('u1')])));
    await mirror.attach(new FsAccessDataStore(dir));
    expect(((await browser.read('flags')) as FlagsDoc).flags.map((f) => f.id)).toEqual(['u1']);
    expect([...browser.copies.keys()]).toEqual([expect.stringMatching(/^flags\.corrupt-/)]);
  });

  it('retries failed folder writes and never loses the latest data', async () => {
    const { browser, mirror, statuses } = setup();
    const dir = new FakeDir();
    await mirror.attach(new FsAccessDataStore(dir));
    dir.failWrites = 3;
    await mirror.write('progress', prog('t1', ['a1']));
    await mirror.write('progress', prog('t2', ['a1', 'a2']));
    await mirror.flush();
    expect(statuses).toContain('failed');
    expect(ids(dir.json('progress.json'))).toEqual(['a1', 'a2']);
    expect(ids((await browser.read('progress')) as ProgressDoc)).toEqual(['a1', 'a2']);
    expect(mirror.getStatus().kind).toBe('folder');
  });

  it('drops the folder on access errors and syncs everything on reconnect', async () => {
    const { browser, mirror } = setup();
    const dir = new FakeDir();
    await mirror.attach(new FsAccessDataStore(dir));
    dir.permission = 'prompt';
    await mirror.write('progress', prog('t1', ['a1']));
    await mirror.flush();
    expect(mirror.getStatus().kind).toBe('lost-access');
    expect(mirror.connected).toBe(false);

    // Keeps saving to the browser while disconnected.
    await mirror.write('progress', prog('t2', ['a1', 'a2']));
    await mirror.write('flags', flagsDoc('t2', [flag('u5')]));
    expect(ids((await browser.read('progress')) as ProgressDoc)).toEqual(['a1', 'a2']);

    dir.permission = 'granted';
    await mirror.attach(new FsAccessDataStore(dir));
    expect(ids(dir.json('progress.json'))).toEqual(['a1', 'a2']);
    expect((dir.json('flags.json') as FlagsDoc).flags.map((f) => f.id)).toEqual(['u5']);
    expect(mirror.getStatus().kind).toBe('folder');
  });

  it('refuses to save an invalid doc', async () => {
    const { mirror } = setup();
    await expect(mirror.write('progress', { schemaVersion: 1, attempts: 'x' })).rejects.toThrow(/Refusing/);
  });
});

function deps(over: Partial<FolderDeps> & { dir?: FakeDir } = {}) {
  const flags = new Map<string, boolean>();
  let saved: FakeDir | undefined = over.dir;
  const d: FolderDeps & { flags: Map<string, boolean> } = {
    supported: true,
    pickFolder: async () => (saved = over.dir ?? new FakeDir()),
    loadHandle: async () => saved,
    saveHandle: async (h) => void (saved = h as FakeDir),
    clearHandle: async () => void (saved = undefined),
    getFlag: (k) => flags.get(k) ?? false,
    setFlag: (k, on) => void flags.set(k, on),
    flags,
    ...over,
  };
  return d;
}

describe('FolderConnection (reconnect state)', () => {
  it('is unsupported without the API', async () => {
    const c = new FolderConnection(new MirroredDataStore(new MemoryDataStore()), deps({ supported: false }));
    await c.init();
    expect(c.state).toBe('unsupported');
  });

  it('first run: not set up, then skip remembers the choice', async () => {
    const d = deps();
    const c = new FolderConnection(new MirroredDataStore(new MemoryDataStore()), d);
    await c.init();
    expect(c.state).toBe('not-set-up');
    c.skip();
    const again = new FolderConnection(new MirroredDataStore(new MemoryDataStore()), { ...d });
    await again.init();
    expect(again.state).toBe('skipped');
  });

  it('connects silently when permission is still granted', async () => {
    const dir = new FakeDir();
    const mirror = new MirroredDataStore(new MemoryDataStore(), fast);
    const c = new FolderConnection(mirror, deps({ dir }));
    await c.init();
    expect(c.state).toBe('connected');
    expect(mirror.connected).toBe(true);
    expect(c.folderName).toBe('data');
  });

  it('needs one click when permission is "prompt", and syncs on reconnect', async () => {
    const dir = new FakeDir();
    dir.permission = 'prompt';
    const browser = new MemoryDataStore();
    await browser.write('progress', prog('2026-11-06T00:00:00Z', ['a7']));
    const mirror = new MirroredDataStore(browser, fast);
    const c = new FolderConnection(mirror, deps({ dir }));
    await c.init();
    expect(c.state).toBe('needs-permission');
    expect(mirror.connected).toBe(false);

    await c.reconnect();
    expect(c.state).toBe('connected');
    expect(ids(dir.json('progress.json'))).toEqual(['a7']);
  });

  it('stays disconnected if she declines the permission prompt', async () => {
    const dir = new FakeDir();
    dir.permission = 'prompt';
    dir.grantOnRequest = 'denied';
    const c = new FolderConnection(new MirroredDataStore(new MemoryDataStore(), fast), deps({ dir }));
    await c.init();
    await c.reconnect();
    expect(c.state).toBe('needs-permission');
  });

  it('offers the backup import once after connecting', async () => {
    const d = deps({ dir: new FakeDir() });
    const c = new FolderConnection(new MirroredDataStore(new MemoryDataStore(), fast), d);
    await c.init();
    expect(c.backupOfferPending).toBe(true);
    c.dismissBackupOffer();
    expect(c.backupOfferPending).toBe(false);
  });

  it('connect() picks, remembers, and syncs a folder; disconnect() forgets it', async () => {
    const d = deps();
    const mirror = new MirroredDataStore(new MemoryDataStore(), fast);
    const c = new FolderConnection(mirror, d);
    await c.init();
    await c.connect();
    expect(c.state).toBe('connected');
    expect(await d.loadHandle()).toBeDefined();
    await c.disconnect();
    expect(c.state).toBe('skipped');
    expect(mirror.connected).toBe(false);
    expect(await d.loadHandle()).toBeUndefined();
  });
});
