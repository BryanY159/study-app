import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makePack } from '../../test/makePack';
import type { Pack } from '../pack/schema';
import { AppProvider } from '../state/AppProvider';
import { MemoryDataStore } from '../storage/DataStore';
import { App } from '../ui/App';
import { shouldShowUpdate, updateSource } from './updates';

describe('shouldShowUpdate', () => {
  it.each([
    ['/', true],
    ['', true],
    ['/drill', false],
    ['/drill/run', false],
    ['/mock', false],
    ['/mock/run', false],
    ['/mock/results/x', false],
    ['/flags', false],
    ['/data', false],
    ['/cards/run', false],
  ])('on %s → %s', (path, shown) => {
    expect(shouldShowUpdate({ needRefresh: true, path, dismissed: false })).toBe(shown);
  });

  it('never without a waiting version, and never after "Later"', () => {
    expect(shouldShowUpdate({ needRefresh: false, path: '/', dismissed: false })).toBe(false);
    expect(shouldShowUpdate({ needRefresh: true, path: '/', dismissed: true })).toBe(false);
  });
});

describe('update banner in the app', () => {
  afterEach(cleanup);
  const noImports = async () => [] as Pack[];

  function renderAt(hash: string) {
    const apply = vi.fn(async () => {});
    const updates = updateSource(apply);
    window.location.hash = hash;
    render(
      <AppProvider store={new MemoryDataStore()} bundledPacks={[makePack({ a: 3 })]} loadImported={noImports} saveImported={async () => {}} updates={updates}>
        <App />
      </AppProvider>,
    );
    return { updates, apply };
  }

  it('an update arriving during a drill waits; back on Home the banner shows; Reload applies it', async () => {
    const { updates, apply } = renderAt('#/drill');
    fireEvent.click(await screen.findByRole('button', { name: /Start drill/ }));
    await screen.findByTestId('drill-position');
    act(() => updates.setNeedRefresh(true));
    expect(screen.queryByTestId('update-banner')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /End drill/ }));
    expect(await screen.findByTestId('update-banner')).toBeInTheDocument();
    expect(apply).not.toHaveBeenCalled(); // nothing reloads by itself
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('not shown on the mock exam screens', async () => {
    const { updates } = renderAt('#/mock');
    await screen.findByRole('button', { name: /Start mock exam/ });
    act(() => updates.setNeedRefresh(true));
    expect(screen.queryByTestId('update-banner')).toBeNull();
  });

  it('"Later" hides it for this run', async () => {
    const { updates } = renderAt('#/');
    await screen.findByText('Welcome back');
    act(() => updates.setNeedRefresh(true));
    fireEvent.click(await screen.findByRole('button', { name: 'Later' }));
    expect(screen.queryByTestId('update-banner')).toBeNull();
  });
});
