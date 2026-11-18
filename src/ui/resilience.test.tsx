import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeLocks } from '../../test/fakeLocks';
import { attempt, makePack } from '../../test/makePack';
import { Boot, type BootDeps } from '../Boot';
import { indexPack } from '../engine/packIndex';
import type { Pack } from '../pack/schema';
import { AppProvider } from '../state/AppProvider';
import { MemoryDataStore, type DataStore } from '../storage/DataStore';
import { emptyFlags, emptyProgress, type FlagsDoc, type ProgressDoc } from '../storage/docs';
import { App } from './App';
import { repairActiveMock } from './screens/Mock';
import { ErrorBoundary } from './screens/StartupError';

const noImports = async () => [] as Pack[];
const noSave = async () => {};
const pack = makePack({ a: 3 });

const bootDeps = (over: Partial<BootDeps> = {}): BootDeps => ({
  bundledPacks: [pack],
  openStore: async () => new MemoryDataStore(),
  legacyStorage: () => null,
  locks: null,
  shareEnv: { touch: false },
  loadImported: noImports,
  saveImported: noSave,
  ...over,
});

// Downloads: capture the text of every file the app saves.
let downloads: { name: string; text: Promise<string> }[] = [];
beforeEach(() => {
  window.location.hash = '';
  downloads = [];
  let lastBlob: Blob | null = null;
  URL.createObjectURL = vi.fn((b: Blob) => ((lastBlob = b), 'blob:x'));
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    if (this.download && lastBlob) downloads.push({ name: this.download, text: lastBlob.text() });
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('C-2: one tab at a time', () => {
  it('a second tab shows "already open"; "Use this tab instead" takes over and the first tab stops saving', async () => {
    const locks = new FakeLocks();
    const shared = new MemoryDataStore();
    const deps = bootDeps({ locks, openStore: async () => shared });
    const a = render(<Boot deps={deps} />);
    await within(a.container).findByText('Welcome back');

    const b = render(<Boot deps={deps} />);
    expect(await within(b.container).findByText('This app is already open in another tab')).toBeInTheDocument();

    fireEvent.click(within(b.container).getByRole('button', { name: 'Use this tab instead' }));
    await within(b.container).findByText('Welcome back');
    expect(await within(a.container).findByTestId('other-tab')).toBeInTheDocument();
  });
});

describe('C-4: startup failures show an error screen', () => {
  it('blocked browser storage: error screen with a rescue download, Try again and details; Try again recovers', async () => {
    let blocked = true;
    render(
      <Boot
        deps={bootDeps({
          openStore: async () => {
            if (blocked) throw new DOMException('The user denied permission to access the database.', 'SecurityError');
            return new MemoryDataStore();
          },
        })}
      />,
    );
    expect(await screen.findByTestId('startup-error')).toBeInTheDocument();
    expect(screen.getByTestId('error-details').textContent).toMatch(/SecurityError/);
    fireEvent.click(screen.getByRole('button', { name: 'Download rescue file' }));
    await waitFor(() => expect(downloads.map((d) => d.name)).toEqual([expect.stringMatching(/^study-sync-rescue-.*\.json$/)]));
    expect(JSON.parse(await downloads[0].text)).toMatchObject({ kind: 'studyapp-sync', formatVersion: 3 });

    blocked = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Welcome back')).toBeInTheDocument();
  });

  it('a failed data load shows the error screen, not endless "Loading…"', async () => {
    const failing: DataStore = { kind: 'memory', read: () => Promise.reject(new Error('disk exploded')), write: async () => {} };
    render(
      <AppProvider store={failing} bundledPacks={[pack]} loadImported={noImports} saveImported={noSave}>
        <App />
      </AppProvider>,
    );
    expect(await screen.findByTestId('startup-error')).toBeInTheDocument();
    expect(screen.getByText("Your saved data couldn't be loaded")).toBeInTheDocument();
    expect(screen.getByTestId('error-details').textContent).toMatch(/disk exploded/);
  });

  it('a data load that never finishes times out to the error screen', async () => {
    const stuck: DataStore = { kind: 'memory', read: () => new Promise(() => {}), write: async () => {} };
    render(
      <AppProvider store={stuck} bundledPacks={[pack]} loadImported={noImports} saveImported={noSave} loadTimeoutMs={30}>
        <App />
      </AppProvider>,
    );
    expect(await screen.findByTestId('startup-error')).toBeInTheDocument();
    expect(screen.getByTestId('error-details').textContent).toMatch(/took longer/);
  });

  it('a render error shows the error screen instead of a blank page', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const Boom = () => {
      throw new Error('render bug');
    };
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(await screen.findByTestId('startup-error')).toBeInTheDocument();
    expect(screen.getByTestId('error-details').textContent).toMatch(/render bug/);
  });
});

describe('first start of v1.5: data from v1.4 moves over once', () => {
  it('shows the v1.4 answers and flags, records the move, and never writes the old keys while she works', async () => {
    const old = { ...emptyProgress(), updatedAt: '2026-11-10T00:00:00.000Z', attempts: [attempt('q-a-0001', true), attempt('q-a-0002', false)] };
    const oldFlags: FlagsDoc = {
      ...emptyFlags(),
      flags: [{ id: 'flag-1', packId: 'test-pack', packVersion: 1, itemType: 'question', questionId: 'q-a-0001', reason: 'typo', comment: 'kept', mode: 'drill', source: 'user', createdAt: '2026-11-09T00:00:00.000Z', updatedAt: '2026-11-09T00:00:00.000Z' }],
    };
    localStorage.setItem('studyapp:progress', JSON.stringify(old));
    localStorage.setItem('studyapp:flags', JSON.stringify(oldFlags));
    const before = { ...localStorage };
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');

    const store = new MemoryDataStore();
    window.location.hash = '#/drill';
    render(<Boot deps={bootDeps({ openStore: async () => store, legacyStorage: () => localStorage })} />);
    // She drills, answering one question.
    fireEvent.click(await screen.findByRole('button', { name: /Start drill/ }));
    await screen.findByTestId('drill-position');
    fireEvent.keyDown(window, { key: 'a' });
    await screen.findByTestId('feedback');
    fireEvent.click(screen.getByRole('button', { name: /End drill/ }));
    await screen.findByText('Welcome back');

    await waitFor(async () => expect(((await store.read('progress')) as ProgressDoc).attempts.length).toBe(3));
    expect(((await store.read('flags')) as FlagsDoc).flags.map((f) => f.comment)).toEqual(['kept']);
    expect(store.meta.legacyMigratedAt).toBeTruthy();
    expect(setItem.mock.calls.filter(([k]) => String(k).startsWith('studyapp:'))).toEqual([]);
    expect(removeItem.mock.calls.filter(([k]) => String(k).startsWith('studyapp:'))).toEqual([]);
    expect({ ...localStorage }).toEqual(before);
  });
});

describe('C-3: Import sync file → Replace (was "restore from backup")', () => {
  const current = (): ProgressDoc => ({ ...emptyProgress(), updatedAt: '2026-11-05T00:00:00Z', attempts: [attempt('q-a-0001', true), attempt('q-a-0002', false), attempt('q-a-0003', true)] });
  // A v1.4-format backup: accepted and upgraded.
  const backupFile = () => {
    const backup = { kind: 'studyapp-backup', createdAt: '2026-10-30T12:00:00.000Z', progress: { ...emptyProgress(), attempts: [attempt('q-a-0001', false)] }, flags: emptyFlags() };
    return new File([JSON.stringify(backup)], 'old-backup.json', { type: 'application/json' });
  };

  async function openData() {
    const store = new MemoryDataStore();
    await store.write('progress', current());
    window.location.hash = '#/data';
    render(
      <AppProvider store={store} bundledPacks={[pack]} loadImported={noImports} saveImported={noSave} shareEnv={{ touch: false }}>
        <App />
      </AppProvider>,
    );
    await screen.findByRole('heading', { name: 'History & data' });
    fireEvent.change(screen.getByTestId('sync-input'), { target: { files: [backupFile()] } });
    expect((await screen.findByTestId('sync-from')).textContent).toMatch(/older version of the app/);
    fireEvent.click(screen.getByRole('radio', { name: /Replace/ }));
    expect(downloads).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Save a safety copy and continue' }));
    return store;
  }

  it('saves a safety copy first, then asks with both counts; Cancel changes nothing', async () => {
    const store = await openData();
    const dialog = await screen.findByTestId('restore-confirm');
    await waitFor(() => expect(downloads.map((d) => d.name)).toEqual([expect.stringMatching(/^study-sync-before-replace-.*\.json$/)]));
    expect(JSON.parse(await downloads[0].text).progress.attempts).toHaveLength(3);
    expect(within(dialog).getByTestId('restore-current').textContent).toMatch(/now30/);
    expect(within(dialog).getByTestId('restore-backup').textContent).toMatch(/10$/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByTestId('restore-confirm')).toBeNull());
    expect(((await store.read('progress')) as ProgressDoc).attempts).toHaveLength(3);
  });

  it('confirming replaces the data with the file and stamps restoredAt', async () => {
    const store = await openData();
    fireEvent.click(within(await screen.findByTestId('restore-confirm')).getByRole('button', { name: 'Replace with this file' }));
    await waitFor(async () => expect(((await store.read('progress')) as ProgressDoc).attempts).toHaveLength(1));
    expect(((await store.read('progress')) as ProgressDoc).restoredAt).not.toBe('');
    expect(screen.getByTestId('data-message').textContent).toMatch(/Replaced this device/);
  });
});

describe('I-5: an unfinished mock that references a retired question', () => {
  it('drops the retired question and resumes', async () => {
    const ix = indexPack(pack);
    const m = {
      sessionId: 'mock-1',
      packId: 'test-pack',
      questionIds: ['q-a-0099', 'q-a-0001', 'q-a-0002'],
      answers: { 'q-a-0099': 'A', 'q-a-0001': 'B' },
      marked: ['q-a-0099'],
      startedAt: new Date().toISOString(),
      timeLimitMinutes: null,
      current: 0,
      warnings: [],
    };
    expect(repairActiveMock(m, ix)).toMatchObject({ questionIds: ['q-a-0001', 'q-a-0002'], answers: { 'q-a-0001': 'B' }, marked: [], current: 0 });

    const store = new MemoryDataStore();
    const session = { id: 'mock-1', mode: 'mock' as const, packId: 'test-pack', label: 'Mock exam', startedAt: m.startedAt, endedAt: null, questionIds: m.questionIds, marked: [], timeLimitMinutes: null };
    await store.write('progress', { ...emptyProgress(), sessions: [session], activeMock: m });
    window.location.hash = '#/mock/run';
    render(
      <AppProvider store={store} bundledPacks={[pack]} loadImported={noImports} saveImported={noSave}>
        <App />
      </AppProvider>,
    );
    expect(await screen.findByText('Mock exam · 2 questions')).toBeInTheDocument();
    await waitFor(async () => expect(((await store.read('progress')) as ProgressDoc).activeMock?.questionIds).toEqual(['q-a-0001', 'q-a-0002']));
  });
});

describe('I-3: importing a pack', () => {
  async function importFile(p: Pack) {
    window.location.hash = '#/data';
    render(
      <AppProvider store={new MemoryDataStore()} bundledPacks={[pack]} loadImported={noImports} saveImported={noSave}>
        <App />
      </AppProvider>,
    );
    await screen.findByRole('heading', { name: 'History & data' });
    fireEvent.change(screen.getByTestId('pack-input'), { target: { files: [new File([JSON.stringify(p)], 'pack.json')] } });
    return (await screen.findByTestId('data-message')).textContent;
  }

  it('rejects the same version number with different questions', async () => {
    const changed = { ...pack, questions: pack.questions.map((q, i) => (i === 0 ? { ...q, stem: 'A reworded stem?' } : q)) };
    expect(await importFile(changed)).toMatch(/same version number \(v1\).*different questions/);
  });

  it('accepts a higher version', async () => {
    expect(await importFile({ ...pack, version: 2 })).toMatch(/Imported .* v2 .*replacing v1/);
  });
});
