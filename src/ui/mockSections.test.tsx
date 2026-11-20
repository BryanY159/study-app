import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fixture from '../../test/fixtures/sample-pack.json';
import { makePack } from '../../test/makePack';
import { indexPack } from '../engine/packIndex';
import { parsePack } from '../pack/checks';
import type { Pack } from '../pack/schema';
import { AppProvider } from '../state/AppProvider';
import { MemoryDataStore } from '../storage/DataStore';
import { emptyProgress, type Attempt, type Session } from '../storage/docs';
import { docCodec } from '../storage/sync';
import { App } from './App';
import { submitMock } from './screens/Mock';

// Orrin sample pack: sections "First season" (group: Glowroots + Skyvines) 3, "Ember moss" (gamma) 3 and "Study bank" (origin) 2.
const parsed = parsePack(structuredClone(fixture));
if (!parsed.ok) throw new Error('fixture');
const pack: Pack = parsed.pack;

const att = (sessionId: string, questionId: string, correct: boolean): Attempt => ({
  id: `${sessionId}|${questionId}`,
  questionId,
  packId: pack.packId,
  sessionId,
  mode: 'mock',
  chosen: correct ? ['A'] : ['B'],
  correct,
  at: '2026-11-20T10:30:00.000Z',
  ms: 1000,
});
const session = (id: string, ids: string[], extra: Partial<Session> = {}): Session => ({
  id,
  mode: 'mock',
  packId: pack.packId,
  label: 'Mock exam',
  startedAt: '2026-11-20T10:00:00.000Z',
  endedAt: '2026-11-20T10:30:00.000Z',
  questionIds: ids,
  marked: [],
  timeLimitMinutes: 10,
  ...extra,
});

const provider = (store: MemoryDataStore, p: Pack = pack) => (
  <AppProvider store={store} bundledPacks={[p]} loadImported={async () => []} saveImported={async () => {}}>
    <App />
  </AppProvider>
);

async function renderResults(ids: string[], right: string[], extra: Partial<Session> = {}) {
  const store = new MemoryDataStore();
  await store.write('progress', { ...emptyProgress(), sessions: [session('m1', ids, extra)], attempts: ids.map((id) => att('m1', id, right.includes(id))) });
  window.location.hash = '#/mock/results/m1';
  render(provider(store));
  return screen.findByTestId('mock-score');
}

// Three First-season questions and the three Ember moss scenario questions.
const IDS = ['q-alpha-0001', 'q-alpha-0002', 'q-alpha-0003', 'q-gamma-0001', 'q-gamma-0002', 'q-gamma-0003'];

beforeEach(() => {
  window.location.hash = '#/';
});
afterEach(cleanup);

describe('mock results with sections', () => {
  it('shows a score per section under the overall score and marks the weakest', async () => {
    await renderResults(IDS, ['q-alpha-0001', 'q-alpha-0002', 'q-gamma-0001']); // 2 / 3, then 1 / 3
    const rows = within(screen.getByTestId('section-scores')).getAllByTestId('section-row');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('First season: 2 / 3, 67%');
    expect(rows[1]).toHaveTextContent('Ember moss: 1 / 3, 33%');
    expect(rows[0]).not.toHaveTextContent('Weakest');
    expect(rows[1]).toHaveTextContent('Weakest');
    expect(screen.getByTestId('mock-score')).toHaveTextContent('3 / 6');
  });

  it('"Drill this section" opens drill setup with that section\'s topics preselected', async () => {
    await renderResults(IDS, ['q-alpha-0001']);
    const links = screen.getAllByTestId('drill-section');
    expect(links[0].getAttribute('href')).toBe('#/drill?topics=alpha-glowroot-anatomy,alpha-glowroot-light,beta-skyvine-signals,beta-skyvine-growth');
    const ember = links[1].getAttribute('href')!;
    expect(ember).toBe('#/drill?topics=gamma-ember-heat,gamma-ember-care');
    cleanup();
    window.location.hash = ember;
    render(provider(new MemoryDataStore()));
    await screen.findByRole('heading', { name: 'Set up a drill' });
    expect((screen.getByRole('checkbox', { name: 'Ember moss' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'First season' }) as HTMLInputElement).checked).toBe(false);
  });

  it('uses the scores saved with the session when there are some', async () => {
    await renderResults(IDS, [], { sectionScores: [{ name: 'First season', correct: 9, total: 11 }, { name: 'Ember moss', correct: 4, total: 11 }] });
    expect(screen.getAllByTestId('section-row')[0]).toHaveTextContent('First season: 9 / 11, 82%');
  });
});

describe('mock results without sections', () => {
  it('look as before: no section block and no Drill this section', async () => {
    const plain = makePack({ a: 3 }, { questionCount: 3 });
    const ids = ['q-a-0001', 'q-a-0002', 'q-a-0003'];
    const store = new MemoryDataStore();
    await store.write('progress', {
      ...emptyProgress(),
      sessions: [{ ...session('m1', ids), packId: 'test-pack' }],
      attempts: ids.map((id) => ({ ...att('m1', id, true), packId: 'test-pack' })),
    });
    window.location.hash = '#/mock/results/m1';
    render(provider(store, plain));
    await screen.findByTestId('mock-score');
    expect(screen.queryByTestId('section-scores')).toBeNull();
    expect(screen.queryByText('Drill this section')).toBeNull();
    expect(screen.getByRole('heading', { name: 'By module' })).toBeInTheDocument();
  });
});

describe('storing section scores with the session', () => {
  const activeFor = (p: Pack, ids: string[]) => ({
    ...emptyProgress(),
    sessions: [session('m1', ids, { endedAt: null, packId: p.packId })],
    activeMock: {
      sessionId: 'm1',
      packId: p.packId,
      questionIds: ids,
      answers: Object.fromEntries(ids.map((id) => [id, null])),
      marked: [],
      startedAt: '2026-11-20T10:00:00.000Z',
      timeLimitMinutes: 10,
      current: 0,
      warnings: [],
    },
  });

  it('submitMock saves a score per section, and they survive the saved-document round trip', () => {
    const done = submitMock(activeFor(pack, IDS), indexPack(pack), new Date('2026-11-20T10:30:00Z'));
    expect(done.sessions[0].sectionScores).toEqual([
      { name: 'First season', correct: 0, total: 3 },
      { name: 'Ember moss', correct: 0, total: 3 },
      { name: 'Study bank', correct: 0, total: 0 },
    ]);
    const back = docCodec.parse('progress', JSON.parse(JSON.stringify(done)));
    expect(back.ok && (back.value as typeof done).sessions[0].sectionScores).toHaveLength(3);
  });

  it('a pack without sections saves no section scores', () => {
    const plain = makePack({ a: 3 }, { questionCount: 3 });
    const done = submitMock(activeFor(plain, ['q-a-0001', 'q-a-0002']), indexPack(plain), new Date('2026-11-20T10:30:00Z'));
    expect('sectionScores' in done.sessions[0]).toBe(false);
  });

  it('the session history on History & data shows the saved section scores', async () => {
    const store = new MemoryDataStore();
    await store.write('progress', {
      ...emptyProgress(),
      sessions: [session('m1', IDS, { sectionScores: [{ name: 'First season', correct: 2, total: 3 }, { name: 'Ember moss', correct: 1, total: 3 }] })],
      attempts: IDS.map((id) => att('m1', id, false)),
    });
    window.location.hash = '#/data';
    render(provider(store));
    expect(await screen.findByTestId('session-sections')).toHaveTextContent('First season 2/3 · Ember moss 1/3');
  });
});
