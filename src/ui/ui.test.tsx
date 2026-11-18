import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attempt, makePack } from '../../test/makePack';
import { indexPack } from '../engine/packIndex';
import type { Pack } from '../pack/schema';
import { AppProvider } from '../state/AppProvider';
import { MemoryDataStore } from '../storage/DataStore';
import type { ShareEnv } from '../storage/backup';
import { emptyFlags, emptyProgress, type ProgressDoc } from '../storage/docs';
import { SafeStore } from '../storage/SafeStore';
import { makeSyncFile } from '../storage/syncFile';
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

describe('saving on this device (no data folder)', () => {
  it('first run goes straight to the app, saving on this device', async () => {
    renderApp(makePack({ a: 3 }));
    expect(await screen.findByText('Welcome back')).toBeInTheDocument();
    expect(screen.queryByText(/data folder/i)).toBeNull();
    expect(screen.getByTestId('save-status').textContent).toBe('Saved on this device');
  });

  it('I-2: data saved by a newer app version shows an update message and is left untouched', async () => {
    const store = new MemoryDataStore();
    const future = JSON.stringify({ schemaVersion: 2, updatedAt: '2026-12-01T00:00:00Z' });
    store.docs.set('progress', future);
    window.location.hash = '#/drill';
    render(
      <AppProvider store={new SafeStore(store)} bundledPacks={[makePack({ a: 3 })]} loadImported={noImports} saveImported={noSave}>
        <App />
      </AppProvider>,
    );
    expect((await screen.findByTestId('newer-version')).textContent).toMatch(/newer version of this app/);
    fireEvent.click(await screen.findByRole('button', { name: /Start drill/ }));
    await screen.findByTestId('drill-position');
    fireEvent.click(screen.getByRole('button', { name: /End drill/ }));
    await waitFor(() => expect(screen.getByText('Welcome back')).toBeInTheDocument());
    expect(store.docs.get('progress')).toBe(future);
  });
});

describe('sync & backup', () => {
  const NOW = new Date('2026-11-17T12:00:00.000Z');
  let downloads: { name: string; text: Promise<string> }[] = [];
  beforeEach(() => {
    downloads = [];
    let lastBlob: Blob | null = null;
    URL.createObjectURL = vi.fn((b: Blob) => ((lastBlob = b), 'blob:x'));
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      if (this.download && lastBlob) downloads.push({ name: this.download, text: lastBlob.text() });
    });
  });
  afterEach(() => vi.restoreAllMocks());

  const desktop: ShareEnv = { touch: false };
  function renderSync(store = new MemoryDataStore(), hash = '#/data', extra: Partial<Parameters<typeof AppProvider>[0]> = {}) {
    window.location.hash = hash;
    render(
      <AppProvider store={store} meta={store} bundledPacks={[makePack({ a: 3 })]} loadImported={noImports} saveImported={noSave} shareEnv={desktop} now={() => NOW} {...extra}>
        <App />
      </AppProvider>,
    );
    return store;
  }
  const withAnswers = async (ids: string[], store = new MemoryDataStore()) => {
    await store.write('progress', { ...emptyProgress(), updatedAt: '2026-11-10T00:00:00.000Z', attempts: ids.map((id) => ({ ...attempt('q-a-0001', true), id })) });
    return store;
  };
  const syncFileOf = (ids: string[], device = 'Laptop') =>
    new File([JSON.stringify(makeSyncFile({ ...emptyProgress(), attempts: ids.map((id) => ({ ...attempt('q-a-0002', true), id })) }, emptyFlags(), { device, now: NOW }))], 'sync.json');

  it('first export asks for a device name; the name goes into the file and is never part of the docs', async () => {
    const store = await withAnswers(['a1']);
    renderSync(store);
    fireEvent.click(await screen.findByRole('button', { name: 'Export sync file' }));
    const prompt = await screen.findByTestId('label-prompt');
    fireEvent.click(within(prompt).getByRole('button', { name: 'Phone' }));
    fireEvent.click(within(prompt).getByRole('button', { name: 'Save name and export' }));
    await waitFor(() => expect(downloads.map((d) => d.name)).toEqual(['study-sync-phone-2026-11-17.json']));
    const file = JSON.parse(await downloads[0].text);
    expect(file).toMatchObject({ kind: 'studyapp-sync', device: 'Phone' });
    expect(file.progress.attempts).toHaveLength(1);
    await waitFor(() => expect(store.meta).toMatchObject({ deviceLabel: 'Phone', lastExportAt: NOW.toISOString() }));
    expect(store.docs.get('progress')).not.toContain('Phone');
    expect(screen.getByTestId('device-label').textContent).toMatch(/This device: Phone/);
    expect(screen.getByTestId('data-message').textContent).toMatch(/Saved study-sync-phone-2026-11-17\.json/);

    // Second export: no prompt.
    fireEvent.click(screen.getByRole('button', { name: 'Export sync file' }));
    await waitFor(() => expect(downloads).toHaveLength(2));
    expect(screen.queryByTestId('label-prompt')).toBeNull();
  });

  it('the device can be renamed on the Data page', async () => {
    const store = renderSync();
    fireEvent.click(await screen.findByRole('button', { name: 'Name this device' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Device name' }), { target: { value: '  Old   iPad ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(store.meta.deviceLabel).toBe('Old iPad'));
  });

  it('import: Merge is preselected, the preview counts what will be added, Merge adds it; the same file again adds nothing', async () => {
    const store = await withAnswers(['a1', 'a2']);
    renderSync(store);
    fireEvent.change(await screen.findByTestId('sync-input'), { target: { files: [syncFileOf(['l1', 'l2', 'l3'])] } });
    const panel = await screen.findByTestId('sync-import');
    expect(within(panel).getByRole('radio', { name: /Merge/ })).toBeChecked();
    expect(within(panel).getByTestId('sync-from').textContent).toMatch(/“Laptop”/);
    expect(within(panel).getByTestId('merge-preview').textContent).toMatch(/\+3 answers/);
    fireEvent.click(within(panel).getByRole('button', { name: 'Merge' }));
    await waitFor(async () => expect(((await store.read('progress')) as ProgressDoc).attempts.map((a) => a.id).sort()).toEqual(['a1', 'a2', 'l1', 'l2', 'l3']));
    expect(screen.getByTestId('data-message').textContent).toMatch(/Merged/);

    fireEvent.change(screen.getByTestId('sync-input'), { target: { files: [syncFileOf(['l1', 'l2', 'l3'])] } });
    expect((await screen.findByTestId('merge-preview')).textContent).toMatch(/nothing this device doesn't already have/);
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    await waitFor(() => expect(screen.queryByTestId('sync-import')).toBeNull());
    expect(((await store.read('progress')) as ProgressDoc).attempts).toHaveLength(5);
  });

  it('import is blocked while a mock exam is in progress', async () => {
    const store = new MemoryDataStore();
    const startedAt = NOW.toISOString();
    await store.write('progress', {
      ...emptyProgress(),
      sessions: [{ id: 'mock-1', mode: 'mock', packId: 'test-pack', label: 'Mock exam', startedAt, endedAt: null, questionIds: ['q-a-0001'], marked: [], timeLimitMinutes: null }],
      activeMock: { sessionId: 'mock-1', packId: 'test-pack', questionIds: ['q-a-0001'], answers: {}, marked: [], startedAt, timeLimitMinutes: null, current: 0, warnings: [] },
    });
    renderSync(store);
    fireEvent.change(await screen.findByTestId('sync-input'), { target: { files: [syncFileOf(['l1'])] } });
    expect((await screen.findByTestId('data-message')).textContent).toMatch(/mock exam is in progress/);
    expect(screen.queryByTestId('sync-import')).toBeNull();
  });

  it('a file from a newer app version is refused and nothing changes', async () => {
    const store = await withAnswers(['a1']);
    renderSync(store);
    const future = new File([JSON.stringify({ ...makeSyncFile(emptyProgress(), emptyFlags(), { device: '' }), formatVersion: 4 })], 'f.json');
    fireEvent.change(await screen.findByTestId('sync-input'), { target: { files: [future] } });
    expect((await screen.findByTestId('data-message')).textContent).toMatch(/newer version of the app/);
    expect(((await store.read('progress')) as ProgressDoc).attempts).toHaveLength(1);
  });

  it('shows whether the browser keeps this data (persist)', async () => {
    renderSync(new MemoryDataStore(), '#/data', { storageManager: { persisted: async () => false, persist: async () => true } });
    await waitFor(() => expect(screen.getByTestId('storage-persistence').textContent).toMatch(/Storage: persistent/));
    cleanup();
    renderSync(new MemoryDataStore(), '#/data', { storageManager: { persisted: async () => false, persist: async () => false } });
    await waitFor(() => expect(screen.getByTestId('storage-persistence').textContent).toMatch(/may clear this data/));
  });

  it('reminder on Home: shown 4 days after the last export; "Not today" hides it; Export now clears it', async () => {
    const store = await withAnswers(['a1']);
    store.meta = { deviceLabel: 'Laptop', lastExportAt: new Date(NOW.getTime() - 4 * 86_400_000).toISOString() };
    renderSync(store, '#/');
    expect((await screen.findByTestId('backup-reminder')).textContent).toMatch(/4 days ago/);
    fireEvent.click(screen.getByRole('button', { name: 'Not today' }));
    await waitFor(() => expect(screen.queryByTestId('backup-reminder')).toBeNull());
    expect(store.meta.reminderSnoozedUntil).toBe(new Date(NOW.getTime() + 86_400_000).toISOString());

    cleanup();
    store.meta = { deviceLabel: 'Laptop' };
    renderSync(store, '#/');
    expect((await screen.findByTestId('backup-reminder')).textContent).toMatch(/haven't exported/);
    fireEvent.click(screen.getByRole('button', { name: 'Export now' }));
    await waitFor(() => expect(screen.queryByTestId('backup-reminder')).toBeNull());
    expect(downloads.map((d) => d.name)).toEqual(['study-sync-laptop-2026-11-17.json']);
  });

  it('no reminder before any answer is saved', async () => {
    renderSync(new MemoryDataStore(), '#/');
    await screen.findByText('Welcome back');
    expect(screen.queryByTestId('backup-reminder')).toBeNull();
  });
});
