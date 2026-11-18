import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDir } from '../../test/fakeFs';
import { FakeLocks } from '../../test/fakeLocks';
import { attempt, makePack } from '../../test/makePack';
import { Boot, type BootDeps } from '../Boot';
import { indexPack } from '../engine/packIndex';
import type { Pack } from '../pack/schema';
import { AppProvider } from '../state/AppProvider';
import { MemoryDataStore, type DataStore } from '../storage/DataStore';
import { emptyFlags, emptyProgress, type ProgressDoc } from '../storage/docs';
import type { FolderDeps } from '../storage/folderConnection';
import { App } from './App';
import { repairActiveMock } from './screens/Mock';
import { ErrorBoundary } from './screens/StartupError';

const noImports = async () => [] as Pack[];
const noSave = async () => {};
const pack = makePack({ a: 3 });
const noFolder: FolderDeps = {
  supported: false,
  pickFolder: async () => {
    throw new Error('no');
  },
  loadHandle: async () => undefined,
  saveHandle: async () => {},
  clearHandle: async () => {},
  getFlag: () => false,
  setFlag: () => {},
};

const bootDeps = (over: Partial<BootDeps> = {}): BootDeps => ({
  bundledPacks: [pack],
  makeBrowserStore: () => new MemoryDataStore(),
  folderDeps: () => noFolder,
  locks: null,
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
});

describe('C-2: one tab at a time', () => {
  it('a second tab shows "already open"; "Use this tab instead" takes over and the first tab stops', async () => {
    const locks = new FakeLocks();
    const shared = new MemoryDataStore();
    const deps = bootDeps({ locks, makeBrowserStore: () => shared });
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
  it('blocked browser storage: error screen with Download backup, Try again and details; Try again recovers', async () => {
    let blocked = true;
    render(
      <Boot
        deps={bootDeps({
          makeBrowserStore: () => {
            if (blocked) throw new DOMException("Failed to read the 'localStorage' property from 'Window': Access is denied", 'SecurityError');
            return new MemoryDataStore();
          },
        })}
      />,
    );
    expect(await screen.findByTestId('startup-error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download backup' })).toBeInTheDocument();
    expect(screen.getByTestId('error-details').textContent).toMatch(/SecurityError/);
    fireEvent.click(screen.getByRole('button', { name: 'Download backup' }));
    expect(downloads.map((d) => d.name)).toEqual([expect.stringMatching(/^study-backup-.*-rescue\.json$/)]);

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

  it('N-2: a data folder that never answers does not block startup, and offers "Reconnect data folder"', async () => {
    render(<Boot deps={bootDeps({ folderTimeoutMs: 30, folderDeps: () => ({ ...noFolder, supported: true, loadHandle: () => new Promise(() => {}) }) })} />);
    expect(await screen.findByText('Welcome back')).toBeInTheDocument();
    expect(screen.getByTestId('save-status').textContent).toBe('Saved in browser — reconnect folder');
    expect(screen.getByRole('button', { name: 'Reconnect data folder' })).toBeInTheDocument();
  });

  it('N-2: a folder whose files hang at startup: the app starts browser-only, and one click reconnects later', async () => {
    class HangingDir extends FakeDir {
      hang = true;
      override async getFileHandle(name: string, opts?: { create?: boolean }) {
        if (this.hang) return new Promise<never>(() => {});
        return super.getFileHandle(name, opts);
      }
    }
    const dir = new HangingDir();
    const flagsMap = new Map<string, boolean>();
    const deps: FolderDeps = { ...noFolder, supported: true, loadHandle: async () => dir, getFlag: (k) => flagsMap.get(k) ?? false, setFlag: (k, on) => void flagsMap.set(k, on) };
    render(<Boot deps={bootDeps({ folderTimeoutMs: 30, folderDeps: () => deps, mirrorOptions: { retryDelays: [1] } })} />);
    expect(await screen.findByText('Welcome back')).toBeInTheDocument();
    expect(screen.getByTestId('save-status').textContent).toBe('Saved in browser — reconnect folder');

    dir.hang = false;
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect data folder' }));
    await waitFor(() => expect(screen.getByTestId('save-status').textContent).toBe('Saved to data folder'));
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

describe('C-3: restore from backup', () => {
  const current = (): ProgressDoc => ({ ...emptyProgress(), updatedAt: '2026-11-05T00:00:00Z', attempts: [attempt('q-a-0001', true), attempt('q-a-0002', false), attempt('q-a-0003', true)] });
  const backupFile = () => {
    const backup = { kind: 'studyapp-backup', createdAt: '2026-10-30T12:00:00.000Z', progress: { ...emptyProgress(), attempts: [attempt('q-a-0001', false)] }, flags: emptyFlags() };
    return new File([JSON.stringify(backup)], 'old-backup.json', { type: 'application/json' });
  };

  async function openData() {
    const store = new MemoryDataStore();
    await store.write('progress', current());
    window.location.hash = '#/data';
    render(
      <AppProvider store={store} bundledPacks={[pack]} loadImported={noImports} saveImported={noSave}>
        <App />
      </AppProvider>,
    );
    await screen.findByRole('heading', { name: 'History & data' });
    fireEvent.change(screen.getByTestId('backup-input'), { target: { files: [backupFile()] } });
    return store;
  }

  it('downloads a safety backup first, then asks with both counts; Cancel changes nothing', async () => {
    const store = await openData();
    const dialog = await screen.findByTestId('restore-confirm');
    expect(downloads.map((d) => d.name)).toEqual([expect.stringMatching(/^study-backup-before-restore-.*\.json$/)]);
    expect(JSON.parse(await downloads[0].text).progress.attempts).toHaveLength(3);
    expect(within(dialog).getByTestId('restore-current').textContent).toMatch(/now30/);
    expect(within(dialog).getByTestId('restore-backup').textContent).toMatch(/10$/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByTestId('restore-confirm')).toBeNull());
    expect(((await store.read('progress')) as ProgressDoc).attempts).toHaveLength(3);
  });

  it('confirming replaces the data with the backup', async () => {
    const store = await openData();
    fireEvent.click(within(await screen.findByTestId('restore-confirm')).getByRole('button', { name: 'Replace with backup' }));
    await waitFor(async () => expect(((await store.read('progress')) as ProgressDoc).attempts).toHaveLength(1));
    expect(screen.getByTestId('data-message').textContent).toMatch(/Restored the backup/);
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
