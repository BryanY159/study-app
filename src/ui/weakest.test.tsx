import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Pack } from '../pack/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attempt, makePack } from '../../test/makePack';
import { WEAKEST_SHOWN, weakestTopics } from '../engine/progress';
import { AppProvider } from '../state/AppProvider';
import { MemoryDataStore } from '../storage/DataStore';
import { emptyProgress } from '../storage/docs';
import { App } from './App';

describe('weakestTopics (FR-17)', () => {
  const t = (id: string, total: number) => ({ id, total });
  // Input is already weakest-first (topicStats' order); untried topics are last.
  const stats = [t('w1', 4), t('w2', 4), t('w3', 2), t('w4', 1), t('w5', 1), t('w6', 3), t('w7', 5), t('never', 0)];

  it('shows the 5 weakest attempted topics, in order', () => {
    expect(weakestTopics(stats, false).map((x) => x.id)).toEqual(['w1', 'w2', 'w3', 'w4', 'w5']);
    expect(WEAKEST_SHOWN).toBe(5);
  });

  it('"Show all" lists every attempted topic and never the untried ones', () => {
    expect(weakestTopics(stats, true).map((x) => x.id)).toEqual(['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7']);
  });

  it('fewer than 5 attempted: shows those; none: empty', () => {
    expect(weakestTopics([t('a', 1), t('b', 0)], false).map((x) => x.id)).toEqual(['a']);
    expect(weakestTopics([t('b', 0)], false)).toEqual([]);
  });
});

describe('Home: weakest topics section', () => {
  afterEach(cleanup);

  it('the Drill weakest action is in the section header, above the list; 5 shown; Show all / Show fewer', async () => {
    // 7 modules with one topic each; one wrong answer in each, so all 7 are "attempted".
    const pack = makePack({ a: 2, b: 2, c: 2, d: 2, e: 2, f: 2, g: 2 });
    const store = new MemoryDataStore();
    await store.write('progress', { ...emptyProgress(), attempts: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((m) => ({ ...attempt(`q-${m}-0001`, false), id: m })) });
    window.location.hash = '#/';
    render(
      <AppProvider store={store} bundledPacks={[pack]} loadImported={async () => []} saveImported={async () => {}}>
        <App />
      </AppProvider>,
    );
    const section = await screen.findByTestId('topics');
    const action = within(section).getByTestId('drill-weakest');
    expect(action).toHaveTextContent('Drill weakest 3 topics');
    expect(action.getAttribute('href')).toMatch(/^#\/drill\?topics=[^,]+,[^,]+,[^,]+$/);
    // Before the list in document order.
    const firstRow = within(section).getAllByTestId('topic-row')[0];
    expect(action.compareDocumentPosition(firstRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(within(section).getAllByTestId('topic-row')).toHaveLength(5);
    fireEvent.click(within(section).getByRole('button', { name: 'Show all topics (7)' }));
    expect(within(section).getAllByTestId('topic-row')).toHaveLength(7);
    fireEvent.click(within(section).getByRole('button', { name: 'Show fewer' }));
    expect(within(section).getAllByTestId('topic-row')).toHaveLength(5);
  });

  it('no answers yet: no action and no toggle', async () => {
    window.location.hash = '#/';
    render(
      <AppProvider store={new MemoryDataStore()} bundledPacks={[makePack({ a: 2 })]} loadImported={async () => []} saveImported={async () => {}}>
        <App />
      </AppProvider>,
    );
    const section = await screen.findByTestId('topics');
    expect(within(section).queryByTestId('drill-weakest')).toBeNull();
    expect(within(section).queryByRole('button', { name: /Show all/ })).toBeNull();
  });
});

describe('Home: path and group tree', () => {
  afterEach(cleanup);
  beforeEach(() => window.localStorage.clear());

  async function home(pack: Pack) {
    const store = new MemoryDataStore();
    await store.write('progress', { ...emptyProgress(), attempts: [{ ...attempt('q-alpha-0001', false), id: 'x1' }, { ...attempt('q-beta-0001', true), id: 'x2' }] });
    window.location.hash = '#/';
    render(
      <AppProvider store={store} bundledPacks={[pack]} loadImported={async () => []} saveImported={async () => {}}>
        <App />
      </AppProvider>,
    );
    return screen.findByTestId('topics');
  }
  const grouped = () => makePack({ alpha: 2, beta: 2 }, { moduleGroups: [{ id: 'g1', name: 'Exam One', moduleIds: ['alpha', 'beta'] }] });

  it('a weakest topic shows its path: group › module', async () => {
    const section = await home(grouped());
    expect(within(section).getAllByTestId('topic-row')[0]).toHaveTextContent('Exam One › ALPHA · 1 answered');
  });

  it('without groups the row shows just the module, as before', async () => {
    const section = await home(makePack({ alpha: 2, beta: 2 }));
    expect(within(section).getAllByTestId('topic-row')[0]).toHaveTextContent(/^alpha topicALPHA · 1 answered/);
  });

  it('the progress tree is collapsed, shows seen / accuracy at every level, and opens level by level', async () => {
    await home(grouped());
    const tree = screen.getByTestId('topic-tree');
    expect(within(tree).getByRole('button', { name: /Exam One/ })).toHaveAttribute('aria-expanded', 'false');
    expect(within(tree).queryByRole('button', { name: /ALPHA/ })).toBeNull();
    expect(tree).toHaveTextContent('50% · 2 of 4 seen'); // group: alpha wrong, beta right
    fireEvent.click(within(tree).getByRole('button', { name: /Exam One/ }));
    expect(tree).toHaveTextContent('0% · 1 of 2 seen'); // ALPHA
    fireEvent.click(within(tree).getByRole('button', { name: /ALPHA/ }));
    expect(within(tree).getByText(/alpha topic/)).toBeInTheDocument();
  });
});
