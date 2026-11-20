import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fixture from '../../test/fixtures/sample-pack.json';
import { makePack } from '../../test/makePack';
import { parsePack } from '../pack/checks';
import type { Pack } from '../pack/schema';
import { AppProvider } from '../state/AppProvider';
import { MemoryDataStore } from '../storage/DataStore';
import { emptyProgress, type Attempt, type Session } from '../storage/docs';
import { App } from './App';

// Orrin sample pack: two study-bank questions (q-bank-0001 has a note) and a 5-option question (q-alpha-0006).
const parsed = parsePack(structuredClone(fixture));
if (!parsed.ok) throw new Error('fixture');
const orrin: Pack = parsed.pack;

/** One-question pack whose single question has options A–E (and, optionally, comes from the study bank). */
function fiveOptionPack(bank = false): Pack {
  const pack = makePack({ alpha: 1 }, { questionCount: 1 });
  const q = pack.questions[0];
  q.options = ['A', 'B', 'C', 'D', 'E'].map((key, i) => ({ key, text: `Option ${key} of ${q.id}`, correct: i === 3, explanation: `Why ${key}` }));
  if (bank) q.origin = 'study-bank';
  return pack;
}

const provider = (store: MemoryDataStore, p: Pack) => (
  <AppProvider store={store} bundledPacks={[p]} loadImported={async () => []} saveImported={async () => {}}>
    <App />
  </AppProvider>
);

async function open(hash: string, pack: Pack, store = new MemoryDataStore()) {
  window.location.hash = hash;
  render(provider(store, pack));
}

const att = (pack: Pack, sessionId: string, questionId: string, chosen: string[], correct: boolean): Attempt => ({
  id: `${sessionId}|${questionId}`,
  questionId,
  packId: pack.packId,
  sessionId,
  mode: 'mock',
  chosen,
  correct,
  at: '2026-11-20T10:30:00.000Z',
  ms: 1000,
});

beforeEach(() => {
  window.location.hash = '#/';
});
afterEach(cleanup);

describe('study bank on Home', () => {
  it('shows a tile with progress and a button to drill the bank only', async () => {
    await open('#/', orrin);
    const tile = await screen.findByTestId('bank-tile');
    expect(within(tile).getByTestId('bank-progress')).toHaveTextContent('0 / 2 worked through');
    expect(within(tile).getByTestId('drill-bank').getAttribute('href')).toBe('#/drill?filter=bank');
  });

  it('counts a bank question once it has been answered (other questions do not count)', async () => {
    const store = new MemoryDataStore();
    const attempts = [att(orrin, 's1', 'q-bank-0001', ['A'], true), att(orrin, 's1', 'q-bank-0001', ['B'], false), att(orrin, 's1', 'q-alpha-0001', ['A'], true)];
    await store.write('progress', { ...emptyProgress(), attempts });
    await open('#/', orrin, store);
    expect(await screen.findByTestId('bank-progress')).toHaveTextContent('1 / 2 worked through');
  });

  it('has no tile when the pack has no study-bank questions', async () => {
    await open('#/', makePack({ alpha: 3 }));
    await screen.findByText('Welcome back');
    expect(screen.queryByTestId('bank-tile')).toBeNull();
  });
});

describe('drill filter "Study bank only"', () => {
  it('is offered when the pack has bank questions, and the Home button opens the drill with it chosen', async () => {
    await open('#/drill?filter=bank', orrin);
    const radio = (await screen.findByRole('radio', { name: /Study bank only/ })) as HTMLInputElement;
    expect(radio.checked).toBe(true);
    expect(screen.getByRole('button', { name: /Start drill · 2 questions/ })).toBeInTheDocument();
  });

  it('can be picked from the filter list', async () => {
    const user = userEvent.setup();
    await open('#/drill', orrin);
    await user.click(await screen.findByRole('radio', { name: /Study bank only/ }));
    expect(screen.getByRole('button', { name: /Start drill · 2 questions/ })).toBeInTheDocument();
  });

  it('is not offered when the pack has no bank questions', async () => {
    await open('#/drill', makePack({ alpha: 3 }));
    await screen.findByRole('heading', { name: 'Set up a drill' });
    expect(screen.queryByRole('radio', { name: /Study bank only/ })).toBeNull();
  });
});

describe('"Instructor\'s study bank" badge and the question note', () => {
  it('shows the badge in a drill, and the note above the explanations once answered', async () => {
    const user = userEvent.setup();
    await open('#/drill?filter=bank&topics=beta-skyvine-growth', orrin); // only q-bank-0001 (has a note)
    await user.click(await screen.findByRole('button', { name: /Start drill · 1 question/ }));
    expect(await screen.findByTestId('bank-badge')).toHaveTextContent("Instructor's study bank");
    expect(screen.queryByTestId('question-note')).toBeNull(); // not before answering
    fireEvent.keyDown(window, { key: 'A' });
    const note = await screen.findByTestId('question-note');
    expect(note).toHaveTextContent('Not found in lecture sources (may be from lab)');
    // The notice sits above the options and their explanations.
    expect(screen.getByTestId('feedback').firstElementChild).toBe(note);
  });

  it('a bank question without a note shows no notice', async () => {
    const user = userEvent.setup();
    await open('#/drill?filter=bank&topics=beta-skyvine-signals', orrin); // only q-bank-0002
    await user.click(await screen.findByRole('button', { name: /Start drill · 1 question/ }));
    expect(await screen.findByTestId('bank-badge')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'A' });
    await screen.findByTestId('feedback');
    expect(screen.queryByTestId('question-note')).toBeNull();
  });

  it('shows no badge on a question from another origin', async () => {
    const user = userEvent.setup();
    await open('#/drill?topics=alpha-glowroot-anatomy', orrin);
    await user.click(await screen.findByRole('button', { name: /Start drill/ }));
    await screen.findByTestId('stem');
    expect(screen.queryByTestId('bank-badge')).toBeNull();
  });

  it('shows the badge and the note in mock results review', async () => {
    const store = new MemoryDataStore();
    const ids = ['q-bank-0001', 'q-alpha-0001'];
    const session: Session = {
      id: 'm1', mode: 'mock', packId: orrin.packId, label: 'Mock exam', startedAt: '2026-11-20T10:00:00.000Z', endedAt: '2026-11-20T10:30:00.000Z',
      questionIds: ids, marked: [], timeLimitMinutes: 10,
    };
    await store.write('progress', { ...emptyProgress(), sessions: [session], attempts: ids.map((id) => att(orrin, 'm1', id, ['B'], false)) });
    await open('#/mock/results/m1', orrin, store);
    await screen.findByTestId('mock-score');
    expect(screen.getAllByTestId('bank-badge')).toHaveLength(1); // only the bank question
    expect(screen.getByTestId('question-note')).toHaveTextContent('Not found in lecture sources');
  });

  it('shows the badge in a mock exam', async () => {
    const user = userEvent.setup();
    await open('#/mock', fiveOptionPack(true));
    await user.click(await screen.findByRole('button', { name: 'Start mock exam' }));
    expect(await screen.findByTestId('bank-badge')).toHaveTextContent("Instructor's study bank");
  });
});

describe('five options (A–E)', () => {
  it('drill: shows option E, and the hint names A–E and 1–5', async () => {
    const user = userEvent.setup();
    await open('#/drill', fiveOptionPack());
    await user.click(await screen.findByRole('button', { name: /Start drill/ }));
    expect(await screen.findAllByRole('radio')).toHaveLength(5);
    expect(screen.getByRole('radio', { name: /Option E of/ })).toBeInTheDocument();
    expect(screen.getByText(/Keys: A–E \(or 1–5\) to answer/)).toBeInTheDocument();
  });

  it.each(['e', 'E', '5'])('drill: pressing "%s" answers with option E', async (key) => {
    const user = userEvent.setup();
    await open('#/drill', fiveOptionPack());
    await user.click(await screen.findByRole('button', { name: /Start drill/ }));
    await screen.findAllByRole('radio');
    fireEvent.keyDown(window, { key });
    const feedback = await screen.findByTestId('feedback');
    const e = within(feedback).getByText('Option E of q-alpha-0001').closest('.option')!;
    expect(e).toHaveTextContent('Your answer · Incorrect');
    expect(e.querySelector('.key')).toHaveTextContent('E');
    // The correct option (D) is marked as well.
    expect(within(feedback).getByText('Option D of q-alpha-0001').closest('.option')).toHaveTextContent('Correct answer');
  });

  it.each(['A', '1', 'd', '4'])('drill: "%s" still picks A–D', async (key) => {
    const user = userEvent.setup();
    await open('#/drill', fiveOptionPack());
    await user.click(await screen.findByRole('button', { name: /Start drill/ }));
    await screen.findAllByRole('radio');
    fireEvent.keyDown(window, { key });
    expect(await screen.findByTestId('feedback')).toBeInTheDocument();
  });

  it.each(['e', '5'])('mock: pressing "%s" picks option E', async (key) => {
    const user = userEvent.setup();
    await open('#/mock', fiveOptionPack());
    await user.click(await screen.findByRole('button', { name: 'Start mock exam' }));
    const e = await screen.findByRole('radio', { name: /Option E of/ });
    expect(e).toHaveAttribute('aria-checked', 'false');
    fireEvent.keyDown(window, { key });
    expect(e).toHaveAttribute('aria-checked', 'true');
  });

  it('mock results: show option E with the student\'s choice marked', async () => {
    const pack = fiveOptionPack();
    const store = new MemoryDataStore();
    const session: Session = {
      id: 'm1', mode: 'mock', packId: pack.packId, label: 'Mock exam', startedAt: '2026-11-20T10:00:00.000Z', endedAt: '2026-11-20T10:30:00.000Z',
      questionIds: ['q-alpha-0001'], marked: [], timeLimitMinutes: 10,
    };
    await store.write('progress', { ...emptyProgress(), sessions: [session], attempts: [att(pack, 'm1', 'q-alpha-0001', ['E'], false)] });
    await open('#/mock/results/m1', pack, store);
    await screen.findByTestId('mock-score');
    const e = screen.getByText('Option E of q-alpha-0001').closest('.option')!;
    expect(e.querySelector('.key')).toHaveTextContent('E');
    expect(e).toHaveTextContent('Your answer · Incorrect');
    expect(screen.getByText('Option D of q-alpha-0001').closest('.option')).toHaveTextContent('Correct answer');
  });
});

describe('"Ask at office hours" in the flag dialog', () => {
  it('can be chosen as the reason', async () => {
    const user = userEvent.setup();
    await open('#/drill', fiveOptionPack());
    await user.click(await screen.findByRole('button', { name: /Start drill/ }));
    await screen.findAllByRole('radio');
    await user.click(screen.getAllByRole('button', { name: 'Flag this question' })[0]);
    await user.click(await screen.findByRole('radio', { name: 'Ask at office hours' }));
    await user.click(screen.getByRole('button', { name: 'Save flag' }));
    window.location.hash = '#/flags';
    const item = await screen.findByTestId('flag-item');
    expect(item).toHaveTextContent('Ask at office hours');
  });
});
