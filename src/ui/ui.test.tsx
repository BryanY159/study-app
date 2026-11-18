import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makePack } from '../../test/makePack';
import { indexPack } from '../engine/packIndex';
import type { Pack } from '../pack/schema';
import { AppProvider } from '../state/AppProvider';
import { MemoryDataStore } from '../storage/DataStore';
import { FolderConnection, type FolderDeps } from '../storage/folderConnection';
import { MirroredDataStore } from '../storage/MirroredDataStore';
import { FakeDir } from '../../test/fakeFs';
import { emptyProgress, type ProgressDoc } from '../storage/docs';
import { App } from './App';
import { submitMock } from './screens/Mock';

const noImports = async () => [] as Pack[];
const noSave = async () => {};

function renderApp(pack: Pack, store = new MemoryDataStore(), hash = '#/') {
  window.location.hash = hash;
  render(
    <AppProvider store={store} bundledPacks={[pack]} loadImported={noImports} saveImported={noSave}>
      <App />
    </AppProvider>,
  );
  return store;
}

async function progressOf(store: MemoryDataStore): Promise<ProgressDoc> {
  return (await store.read('progress')) as ProgressDoc;
}

beforeEach(() => {
  window.location.hash = '';
});
afterEach(cleanup);

describe('drill', () => {
  it('answers by keyboard, shows feedback, records the attempt, keeps option order', async () => {
    const pack = makePack({ a: 5 });
    const store = renderApp(pack, new MemoryDataStore(), '#/drill');
    fireEvent.click(await screen.findByRole('button', { name: /Start drill/ }));
    await screen.findByTestId('drill-position');

    const stem = screen.getByTestId('stem').textContent!;
    const q = pack.questions.find((x) => stem.includes(x.id))!;
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual(q.options.map((o) => `${o.key}${o.text}`));

    fireEvent.keyDown(window, { key: 'c' });
    const fb = await screen.findByTestId('feedback');
    expect(fb.textContent).toContain('Why A');
    expect(fb.textContent).toContain('Why D');
    expect(screen.getByRole('status').textContent).toMatch(q.options[2].correct ? /Correct/ : /Incorrect/);

    await waitFor(async () => expect((await progressOf(store)).attempts).toHaveLength(1));
    const a = (await progressOf(store)).attempts[0];
    expect(a).toMatchObject({ questionId: q.id, chosen: ['C'], correct: q.options[2].correct, mode: 'drill' });

    fireEvent.keyDown(window, { key: 'Enter' });
    expect(screen.getByTestId('drill-position').textContent).toMatch(/Question 2 of 5/);
  });

  it('ending early keeps the partial session', async () => {
    const store = renderApp(makePack({ a: 5 }), new MemoryDataStore(), '#/drill');
    fireEvent.click(await screen.findByRole('button', { name: /Start drill/ }));
    await screen.findByTestId('drill-position');
    fireEvent.keyDown(window, { key: '1' });
    await screen.findByTestId('feedback');
    fireEvent.click(screen.getByRole('button', { name: /End drill/ }));
    await waitFor(async () => {
      const p = await progressOf(store);
      expect(p.sessions[0].endedAt).not.toBeNull();
      expect(p.attempts).toHaveLength(1);
    });
    expect(await screen.findAllByTestId('session-row')).toHaveLength(1);
  });

  it('flags a question from the drill', async () => {
    const store = renderApp(makePack({ a: 3 }), new MemoryDataStore(), '#/drill');
    fireEvent.click(await screen.findByRole('button', { name: /Start drill/ }));
    await screen.findByTestId('drill-position');
    fireEvent.keyDown(window, { key: 'f' });
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'Looks wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save flag' }));
    await waitFor(async () => {
      const flags = (await store.read('flags')) as { flags: { comment: string; packVersion: number }[] };
      expect(flags.flags[0]).toMatchObject({ comment: 'Looks wrong', packVersion: 1 });
    });
  });
});

describe('mock', () => {
  const pack = makePack({ alpha: 20, beta: 10, gamma: 15 });
  const ix = indexPack(pack);
  const active = (startedAt: string, answers: Record<string, string>) => {
    const p = emptyProgress();
    const questionIds = pack.questions.slice(0, 33).map((q) => q.id);
    p.sessions = [{ id: 'mock-1', mode: 'mock', packId: pack.packId, label: 'Mock exam', startedAt, endedAt: null, questionIds, marked: [], timeLimitMinutes: 50 }];
    p.activeMock = { sessionId: 'mock-1', packId: pack.packId, questionIds, answers, marked: [questionIds[1]], startedAt, timeLimitMinutes: 50, current: 0, warnings: [] };
    return p;
  };

  it('submitMock scores blanks as wrong and closes the session', () => {
    const q0 = pack.questions[0];
    const key = q0.options.find((o) => o.correct)!.key;
    const out = submitMock(active('2026-11-05T10:00:00Z', { [q0.id]: key }), ix, new Date('2026-11-05T10:30:00Z'));
    expect(out.activeMock).toBeNull();
    expect(out.attempts).toHaveLength(33);
    expect(out.attempts.filter((a) => a.correct)).toHaveLength(1);
    expect(out.attempts.filter((a) => a.chosen.length === 0)).toHaveLength(32);
    expect(out.sessions[0].endedAt).toBe('2026-11-05T10:30:00.000Z');
    expect(out.sessions[0].marked).toHaveLength(1);
  });

  it('resumes an exam in progress after a reload', async () => {
    const store = new MemoryDataStore();
    await store.write('progress', active(new Date().toISOString(), {}));
    renderApp(pack, store, '#/mock');
    fireEvent.click(await screen.findByRole('link', { name: 'Resume exam' }));
    act(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
    expect((await screen.findByTestId('mock-position')).textContent).toMatch(/Question 1 of 33/);
  });

  it('auto-submits when time runs out', async () => {
    const store = new MemoryDataStore();
    const started = new Date(Date.now() - 51 * 60_000).toISOString();
    await store.write('progress', active(started, {}));
    renderApp(pack, store, '#/mock/run');
    await waitFor(async () => expect((await progressOf(store)).activeMock).toBeNull());
    const p = await progressOf(store);
    expect(p.attempts).toHaveLength(33);
    expect(p.attempts.every((a) => !a.correct)).toBe(true);
    expect(window.location.hash).toBe('#/mock/results/mock-1');
  });
});

describe('unconfirmed questions', () => {
  const withPreflag = () => {
    const pack = makePack({ a: 2 });
    Object.assign(pack.questions[0], { status: 'unconfirmed', preflag: { reason: 'unclear', note: 'Slide 12 and the lecture disagree.' } });
    pack.questions[1].topicIds = ['a-t'];
    return pack;
  };

  it('shows the banner with the note in a drill', async () => {
    const pack = withPreflag();
    pack.questions = [pack.questions[0]];
    renderApp(pack, new MemoryDataStore(), '#/drill');
    fireEvent.click(await screen.findByRole('button', { name: /Start drill/ }));
    const banner = await screen.findByTestId('unconfirmed');
    expect(banner.textContent).toContain('Unconfirmed — check with your notes or instructor.');
    expect(banner.textContent).toContain('Slide 12 and the lecture disagree.');
  });

  it('seeds an open pre-flag into the Flags list where she can comment', async () => {
    const store = renderApp(withPreflag(), new MemoryDataStore(), '#/flags');
    const item = await screen.findByTestId('flag-item');
    expect(item.textContent).toContain('Pre-flagged');
    expect(item.textContent).toContain('Slide 12 and the lecture disagree.');
    expect(screen.queryByRole('button', { name: 'Remove flag' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'Instructor said it lacks both' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save flag' }));
    await waitFor(async () => {
      const flags = (await store.read('flags')) as { flags: { source: string; comment: string }[] };
      expect(flags.flags).toHaveLength(1);
      expect(flags.flags[0]).toMatchObject({ source: 'preflag', comment: 'Instructor said it lacks both' });
    });
  });
});

describe('data folder', () => {
  const folderDeps = (dir: FakeDir | undefined, flags = new Map<string, boolean>()): FolderDeps => {
    let saved = dir;
    return {
      supported: true,
      pickFolder: async () => (saved = dir ?? new FakeDir()),
      loadHandle: async () => saved,
      saveHandle: async (h) => void (saved = h as FakeDir),
      clearHandle: async () => void (saved = undefined),
      getFlag: (k) => flags.get(k) ?? false,
      setFlag: (k, on) => void flags.set(k, on),
    };
  };

  async function renderWithFolder(dir: FakeDir | undefined, hash = '#/', pack = makePack({ a: 3 })) {
    const mirror = new MirroredDataStore(new MemoryDataStore(), { retryDelays: [1] });
    const folder = new FolderConnection(mirror, folderDeps(dir));
    await folder.init();
    window.location.hash = hash;
    render(
      <AppProvider store={mirror} bundledPacks={[pack]} loadImported={noImports} saveImported={noSave} folder={folder}>
        <App />
      </AppProvider>,
    );
    return { mirror, folder };
  }

  it('first run asks for the folder; "Skip for now" keeps browser-only saving', async () => {
    await renderWithFolder(undefined);
    expect(await screen.findByTestId('connect-folder')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(await screen.findByText('Welcome back')).toBeInTheDocument();
    expect(screen.getByTestId('save-status').textContent).toBe('Saved in browser');
  });

  it('connecting from the first-run screen saves to the folder and offers a backup import once', async () => {
    const dir = new FakeDir();
    const { folder } = await renderWithFolder(undefined);
    (folder as unknown as { deps: FolderDeps }).deps.pickFolder = async () => dir;
    fireEvent.click(await screen.findByRole('button', { name: 'Choose data folder' }));
    expect(await screen.findByTestId('backup-offer')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('save-status').textContent).toBe('Saved to data folder'));
    fireEvent.click(screen.getByRole('button', { name: 'No thanks' }));
    await waitFor(() => expect(screen.queryByTestId('backup-offer')).toBeNull());
  });

  it('C-1: a cleared browser connecting to a folder that has flags keeps all of them', async () => {
    const pack = makePack({ a: 3 });
    pack.questions[2] = { ...pack.questions[2], status: 'unconfirmed', preflag: { reason: 'answer-wrong', note: 'Check with the instructor' } };
    const preflagId = 'preflag-test-pack-q-a-0003';
    const dir = new FakeDir();
    const base = { packId: 'test-pack', packVersion: 1, mode: 'review', createdAt: '2026-11-01T00:00:00.000Z' };
    const saved = [
      { ...base, id: 'flag-1', questionId: 'q-a-0001', reason: 'answer-wrong', comment: 'B is right', source: 'user', updatedAt: '2026-11-02T00:00:00.000Z' },
      { ...base, id: 'flag-2', questionId: 'q-a-0002', reason: 'typo', comment: '', source: 'user', updatedAt: '2026-11-02T00:00:00.000Z' },
      { ...base, id: preflagId, questionId: 'q-a-0003', reason: 'answer-wrong', comment: 'TA says A', source: 'preflag', updatedAt: '2026-11-03T00:00:00.000Z' },
    ];
    dir.files.set('flags.json', JSON.stringify({ schemaVersion: 1, updatedAt: '2026-11-03T00:00:00.000Z', flags: saved }));

    // Fresh browser: no saved handle, so the first-run screen shows (and the app has already seeded the pre-flag).
    const { folder, mirror } = await renderWithFolder(undefined, '#/', pack);
    (folder as unknown as { deps: FolderDeps }).deps.pickFolder = async () => dir;
    fireEvent.click(await screen.findByRole('button', { name: 'Choose data folder' }));
    await screen.findByTestId('backup-offer');
    await mirror.flush();

    const inFolder = dir.json('flags.json').flags as { id: string; comment: string }[];
    expect(inFolder.map((f) => f.id).sort()).toEqual(['flag-1', 'flag-2', preflagId]);
    expect(inFolder.find((f) => f.id === preflagId)!.comment).toBe('TA says A');
    window.location.hash = '#/flags';
    expect(await screen.findByText(/B is right/)).toBeInTheDocument();
    expect(screen.getByText(/TA says A/)).toBeInTheDocument();
  });

  it('I-2: a folder saved by a newer app version opens browser-only with an update message, and is left untouched', async () => {
    const dir = new FakeDir();
    const future = JSON.stringify({ schemaVersion: 2, updatedAt: '2026-12-01T00:00:00Z' });
    dir.files.set('progress.json', future);
    await renderWithFolder(dir, '#/drill');
    expect((await screen.findByTestId('newer-version')).textContent).toMatch(/Your data was saved by a newer version of this app; update index.html/);
    expect(screen.getByTestId('save-status').textContent).toBe('Saved in browser only — update the app');
    fireEvent.click(await screen.findByRole('button', { name: /Start drill/ }));
    await screen.findByTestId('drill-position');
    fireEvent.click(screen.getByRole('button', { name: /End drill/ }));
    await waitFor(() => expect(screen.getByText('Welcome back')).toBeInTheDocument());
    expect(dir.files.get('progress.json')).toBe(future);
    expect(dir.writes).toBe(0);
  });

  it('shows "Reconnect data folder" when permission is "prompt"; one click reconnects and syncs', async () => {
    const dir = new FakeDir();
    dir.permission = 'prompt';
    const { mirror } = await renderWithFolder(dir, '#/drill');
    expect((await screen.findByTestId('save-status')).textContent).toBe('Saved in browser — reconnect folder');

    // Answer while disconnected: saved to the browser only.
    fireEvent.click(await screen.findByRole('button', { name: /Start drill/ }));
    await screen.findByTestId('drill-position');
    fireEvent.click(screen.getByRole('button', { name: /End drill/ }));
    expect(dir.files.size).toBe(0);

    fireEvent.click(await screen.findByRole('button', { name: 'Reconnect data folder' }));
    await waitFor(() => expect(screen.getByTestId('save-status').textContent).toBe('Saved to data folder'));
    await mirror.flush();
    expect(dir.json('progress.json').sessions).toHaveLength(1);
  });

  it('shows "Save failed" while folder writes are failing, then recovers', async () => {
    const dir = new FakeDir();
    const { mirror } = await renderWithFolder(dir, '#/drill');
    dir.failWrites = 1000;
    fireEvent.click(await screen.findByRole('button', { name: /Start drill/ }));
    await screen.findByTestId('drill-position');
    fireEvent.click(screen.getByRole('button', { name: /End drill/ }));
    await waitFor(() => expect(screen.getByTestId('save-status').textContent).toMatch(/^Save failed/));
    dir.failWrites = 0;
    await mirror.flush();
    await waitFor(() => expect(screen.getByTestId('save-status').textContent).toBe('Saved to data folder'));
    expect(dir.json('progress.json').sessions).toHaveLength(1);
  });
});
