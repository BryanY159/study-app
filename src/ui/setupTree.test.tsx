import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fixture from '../../test/fixtures/sample-pack.json';
import { parsePack } from '../pack/checks';
import type { Pack } from '../pack/schema';
import { AppProvider } from '../state/AppProvider';
import { MemoryDataStore } from '../storage/DataStore';
import { App } from './App';

// The group > module > topic tree on drill setup and card deck setup (Orrin: "First season" = Glowroots + Skyvines, "Second season" = Ember moss).
const parsed = parsePack(structuredClone(fixture));
if (!parsed.ok) throw new Error('fixture');
const pack: Pack = parsed.pack;

function renderAt(hash: string, p: Pack = pack) {
  window.location.hash = hash;
  render(
    <AppProvider store={new MemoryDataStore()} bundledPacks={[p]} loadImported={async () => []} saveImported={async () => {}} now={() => new Date('2026-11-17T10:00:00')}>
      <App />
    </AppProvider>,
  );
}

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const box = (name: string | RegExp) => screen.getByRole('checkbox', { name }) as HTMLInputElement;

describe('drill setup tree', () => {
  it('opens collapsed with everything selected and a count on each row', async () => {
    renderAt('#/drill');
    await screen.findByRole('heading', { name: 'Set up a drill' });
    expect(box('First season').checked).toBe(true);
    expect(screen.queryByRole('checkbox', { name: 'Glowroots' })).not.toBeInTheDocument();
    // First season = Glowroots (6 questions) + Skyvines (6); Second season = Ember moss (3 confirmed, 1 unconfirmed).
    expect(screen.getByLabelText('12 questions')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start drill · 16 questions/ })).toBeInTheDocument();
  });

  it('unticking a group clears everything below, and the start count follows', async () => {
    renderAt('#/drill');
    await screen.findByRole('heading', { name: 'Set up a drill' });
    fireEvent.click(box('First season'));
    expect(box('First season').checked).toBe(false);
    expect(screen.getByRole('button', { name: /Start drill · 4 questions/ })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('tree-expand-all'));
    expect(box('Glowroots').checked).toBe(false);
    expect(box('Glowroot anatomy').checked).toBe(false);
  });

  it('one topic unticked makes its module and group partly selected', async () => {
    renderAt('#/drill');
    await screen.findByRole('heading', { name: 'Set up a drill' });
    fireEvent.click(screen.getByTestId('tree-expand-all'));
    fireEvent.click(box('Glowroot anatomy'));
    expect(box('Glowroots').indeterminate).toBe(true);
    expect(box('First season').indeterminate).toBe(true);
    expect(box('Skyvines').indeterminate).toBe(false);
    expect(box('Ember moss').checked).toBe(true);
  });

  it('a preselected topic (from a link) opens the path to it and selects only it', async () => {
    renderAt('#/drill?topics=beta-skyvine-growth');
    await screen.findByRole('heading', { name: 'Set up a drill' });
    expect(box('Skyvine growth').checked).toBe(true);
    expect(box('Skyvine signalling').checked).toBe(false);
    expect(box('Second season').checked).toBe(false);
    // Opening it for her is not remembered.
    expect(window.localStorage.getItem('study-ui:tree:drill:sample-orrin')).toBeNull();
  });

  it('a pack without groups shows modules at the top level, as before', async () => {
    const plain = structuredClone(pack) as Pack;
    delete plain.groups;
    plain.examBlueprint = { ...plain.examBlueprint, sections: undefined };
    renderAt('#/drill', plain);
    await screen.findByRole('heading', { name: 'Set up a drill' });
    expect(box('Glowroots')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'First season' })).not.toBeInTheDocument();
  });
});

describe('card deck setup tree', () => {
  it('shows due / new at every level and learned on topics', async () => {
    renderAt('#/cards');
    await screen.findByRole('heading', { level: 1, name: 'Flashcards' });
    expect(box('First season')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('tree-expand-all'));
    const rows = screen.getAllByTestId('tree-topic');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].textContent).toMatch(/learned/);
    expect(screen.getAllByTestId('tree-group')[0].querySelector('.tt-meta')?.textContent).toMatch(/\d+ due · \d+ new/);
  });

  it('only topics that have cards are listed, and group ticks cascade to the Start count', async () => {
    renderAt('#/cards');
    await screen.findByTestId('start-cards');
    const before = screen.getByTestId('start-cards').textContent;
    fireEvent.click(box('First season'));
    expect(screen.getByTestId('start-cards').textContent).not.toBe(before);
  });
});
