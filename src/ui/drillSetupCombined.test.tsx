import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fixture from '../../test/fixtures/sample-pack.json';
import { parsePack } from '../pack/checks';
import type { Pack } from '../pack/schema';
import { AppProvider } from '../state/AppProvider';
import { MemoryDataStore } from '../storage/DataStore';
import { emptyProgress, type Attempt } from '../storage/docs';
import { App } from './App';

// Orrin: 16 questions, two from the study bank (q-bank-0001 in beta-skyvine-growth, q-bank-0002 in beta-skyvine-signals).
const parsed = parsePack(structuredClone(fixture));
if (!parsed.ok) throw new Error('fixture');
const orrin: Pack = parsed.pack;

const att = (questionId: string, correct: boolean): Attempt => ({
  id: `s1|${questionId}`,
  questionId,
  packId: orrin.packId,
  sessionId: 's1',
  mode: 'drill',
  chosen: ['A'],
  correct,
  at: '2026-11-20T10:30:00.000Z',
  ms: 1000,
});
// One bank question missed, one non-bank question missed.
const attempts = [att('q-bank-0001', false), att('q-alpha-0001', false)];

async function open(hash: string) {
  const store = new MemoryDataStore();
  await store.write('progress', { ...emptyProgress(), attempts });
  window.location.hash = hash;
  render(
    <AppProvider store={store} bundledPacks={[orrin]} loadImported={async () => []} saveImported={async () => {}}>
      <App />
    </AppProvider>,
  );
}

const count = (name: RegExp) => within(screen.getByRole('radio', { name }).closest('label') as HTMLElement).getByText(/^\(\d+\)$/).textContent;

beforeEach(() => {
  window.location.hash = '#/';
});
afterEach(cleanup);

describe('drill setup: source and filter combine (v2.3.1)', () => {
  it('the Home button opens setup with "Study bank only" and "Not seen yet" chosen', async () => {
    await open('#/');
    const href = (await screen.findByTestId('drill-bank')).getAttribute('href')!;
    expect(href).toBe('#/drill?source=bank&filter=unseen');
    cleanup();
    await open(href);
    expect(await screen.findByRole('radio', { name: 'Study bank only' })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Not seen yet/ })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Start drill · 1 study bank not seen yet' })).toBeInTheDocument();
  });

  it('has two groups; each "Which ones" option shows its count for the current source', async () => {
    const user = userEvent.setup();
    await open('#/drill');
    await screen.findByRole('radiogroup', { name: 'Questions from' });
    expect(screen.getByRole('radiogroup', { name: 'Which ones' })).toBeInTheDocument();
    expect(count(/^All \(/)).toBe('(16)');
    expect(count(/Not seen yet/)).toBe('(14)');
    expect(count(/Previously missed/)).toBe('(2)');
    await user.click(screen.getByRole('radio', { name: 'Study bank only' }));
    expect(count(/^All \(/)).toBe('(2)');
    expect(count(/Not seen yet/)).toBe('(1)');
    expect(count(/Previously missed/)).toBe('(1)');
  });

  it('counts follow the topic selection and the Start button states the total', async () => {
    const user = userEvent.setup();
    await open('#/drill?source=bank&topics=beta-skyvine-growth');
    expect(await screen.findByRole('button', { name: 'Start drill · 1 study bank question' })).toBeInTheDocument();
    expect(count(/Not seen yet/)).toBe('(0)');
    expect(count(/Previously missed/)).toBe('(1)');
    await user.click(screen.getByRole('radio', { name: /Previously missed/ }));
    expect(screen.getByRole('button', { name: 'Start drill · 1 study bank previously missed' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'All questions' }));
    expect(screen.getByRole('button', { name: 'Start drill · 1 previously missed' })).toBeInTheDocument();
  });

  it('an older ?filter=bank link means study bank, all of it', async () => {
    await open('#/drill?filter=bank');
    expect(await screen.findByRole('radio', { name: 'Study bank only' })).toBeChecked();
    expect(screen.getByRole('radio', { name: /^All \(/ })).toBeChecked();
  });

  it('a started drill holds only the combined questions', async () => {
    const user = userEvent.setup();
    await open('#/drill?source=bank&filter=unseen');
    await user.click(await screen.findByRole('button', { name: 'Start drill · 1 study bank not seen yet' }));
    expect(await screen.findByTestId('bank-badge')).toBeInTheDocument();
    expect(screen.getByText(/1 of 1/i)).toBeInTheDocument();
  });
});
