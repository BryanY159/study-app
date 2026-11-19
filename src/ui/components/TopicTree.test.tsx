import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makePack } from '../../../test/makePack';
import { indexPack } from '../../engine/packIndex';
import { buildTree, sumBy } from '../topicTree';
import { useExpanded } from '../useExpanded';
import { TopicTree } from './TopicTree';

const ix = indexPack(
  makePack(
    { alpha: 2, beta: 2, gamma: 2 },
    { moduleGroups: [{ id: 'first', name: 'First season', moduleIds: ['alpha', 'beta'] }] },
  ),
);

function Harness({ screen = 'test', preset = [] as string[], selectable = true }: { screen?: string; preset?: string[]; selectable?: boolean }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const expanded = useExpanded(screen, 'p1', preset);
  return (
    <TopicTree
      label="Topics"
      nodes={buildTree(ix)}
      expanded={expanded}
      selection={selectable ? { selected: sel, onChange: setSel } : undefined}
      meta={(n) => <span>{sumBy(n, () => 2)} q</span>}
    />
  );
}

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe('TopicTree', () => {
  it('is collapsed by default: only the top level shows, with counts', () => {
    render(<Harness />);
    expect(screen.getByRole('checkbox', { name: 'First season' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'GAMMA' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'ALPHA' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand First season' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('4 q')).toBeInTheDocument(); // group = 2 modules x 1 topic x 2
  });

  it('opens a level at a time and shows counts at every level', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Expand First season' }));
    expect(screen.getByRole('checkbox', { name: 'ALPHA' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'alpha topic' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Expand ALPHA' }));
    expect(screen.getByRole('checkbox', { name: 'alpha topic' })).toBeInTheDocument();
  });

  it('cascades: ticking a group ticks everything below, and unticking one topic leaves its parents partly selected', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Expand all' }));
    await user.click(screen.getByRole('checkbox', { name: 'First season' }));
    for (const n of ['First season', 'ALPHA', 'alpha topic', 'BETA', 'beta topic']) expect(screen.getByRole('checkbox', { name: n })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'GAMMA' })).not.toBeChecked();

    await user.click(screen.getByRole('checkbox', { name: 'beta topic' }));
    const group = screen.getByRole('checkbox', { name: 'First season' }) as HTMLInputElement;
    const beta = screen.getByRole('checkbox', { name: 'BETA' }) as HTMLInputElement;
    expect(group.indeterminate).toBe(true);
    expect(group.checked).toBe(false);
    expect(beta.indeterminate).toBe(false);
    expect((screen.getByRole('checkbox', { name: 'ALPHA' }) as HTMLInputElement).checked).toBe(true);
  });

  it('remembers what is open across a remount, per screen and pack', async () => {
    const user = userEvent.setup();
    const first = render(<Harness screen="drill" />);
    await user.click(screen.getByRole('button', { name: 'Expand First season' }));
    first.unmount();

    render(<Harness screen="drill" />);
    expect(screen.getByRole('button', { name: /Collapse First season/ })).toHaveAttribute('aria-expanded', 'true');
    expect(JSON.parse(window.localStorage.getItem('study-ui:tree:drill:p1')!)).toEqual(['g:first']);
  });

  it('keeps each screen separate', async () => {
    const user = userEvent.setup();
    const a = render(<Harness screen="drill" />);
    await user.click(screen.getByRole('button', { name: 'Expand First season' }));
    a.unmount();
    render(<Harness screen="cards" />);
    expect(screen.getByRole('button', { name: 'Expand First season' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens a preset path for this visit without saving it', async () => {
    const user = userEvent.setup();
    render(<Harness screen="drill" preset={['g:first']} />);
    expect(screen.getByRole('checkbox', { name: 'ALPHA' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Expand GAMMA' }));
    expect(JSON.parse(window.localStorage.getItem('study-ui:tree:drill:p1')!)).toEqual(['m:gamma']);
  });

  it('still works when storage is blocked', async () => {
    const user = userEvent.setup();
    const orig = Storage.prototype.getItem;
    const origSet = Storage.prototype.setItem;
    Storage.prototype.getItem = () => {
      throw new Error('blocked');
    };
    Storage.prototype.setItem = () => {
      throw new Error('blocked');
    };
    try {
      render(<Harness />);
      await user.click(screen.getByRole('button', { name: 'Expand First season' }));
      expect(screen.getByRole('checkbox', { name: 'ALPHA' })).toBeInTheDocument();
    } finally {
      Storage.prototype.getItem = orig;
      Storage.prototype.setItem = origSet;
    }
  });

  it('works from the keyboard alone: Tab to a chevron, Enter opens, Space ticks', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.tab(); // "Expand all"
    await user.tab(); // first chevron
    expect(screen.getByRole('button', { name: 'Expand First season' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('checkbox', { name: 'ALPHA' })).toBeInTheDocument();
    await user.tab(); // the group's checkbox
    expect(screen.getByRole('checkbox', { name: 'First season' })).toHaveFocus();
    await user.keyboard(' ');
    expect(screen.getByRole('checkbox', { name: 'First season' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'ALPHA' })).toBeChecked();
  });

  it('without a selection (Home) a branch is one button with its name, and leaves have no checkbox', async () => {
    const user = userEvent.setup();
    render(<Harness selectable={false} />);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: /First season/ }));
    expect(screen.getByRole('button', { name: /ALPHA/ })).toBeInTheDocument();
  });
});
