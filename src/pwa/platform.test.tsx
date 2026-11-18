import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { makePack } from '../../test/makePack';
import type { Pack } from '../pack/schema';
import { AppProvider } from '../state/AppProvider';
import { MemoryDataStore } from '../storage/DataStore';
import { App } from '../ui/App';
import { InstallHelp } from '../ui/screens/InstallHelp';
import { detectPlatform } from './platform';

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1',
  ipadAsMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  winChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
};

describe('detectPlatform', () => {
  it.each([
    ['iPhone Safari', UA.iphoneSafari, 5, 'ios-safari'],
    ['iPhone Chrome', UA.iphoneChrome, 5, 'ios-other-browser'],
    ['iPad presenting as a Mac (touch)', UA.ipadAsMac, 5, 'ios-safari'],
    ['a real Mac (no touch)', UA.macSafari, 0, 'desktop-other'],
    ['Windows Chrome', UA.winChrome, 0, 'desktop-chromium'],
    ['Windows Edge', UA.winEdge, 0, 'desktop-chromium'],
    ['Firefox', UA.firefox, 0, 'desktop-other'],
    ['Android Chrome', UA.android, 5, 'android'],
  ])('%s → %s', (_name, ua, touch, platform) => {
    expect(detectPlatform(ua, touch, false)).toEqual({ platform, installed: false });
  });

  it('reports an installed (standalone) app', () => {
    expect(detectPlatform(UA.iphoneSafari, 5, true).installed).toBe(true);
  });
});

describe('install help', () => {
  afterEach(cleanup);

  it('shows this device first, the others folded away', () => {
    render(<InstallHelp info={{ platform: 'ios-safari', installed: false }} />);
    expect(screen.getByTestId('install-mine').textContent).toMatch(/iPhone or iPad \(Safari\).*Add to Home Screen/);
    expect(screen.getByText('Other devices')).toBeInTheDocument();
    expect(screen.queryByTestId('installed')).toBeNull();
  });

  it('says so when already installed', () => {
    render(<InstallHelp info={{ platform: 'desktop-chromium', installed: true }} />);
    expect(screen.getByTestId('installed')).toBeInTheDocument();
    expect(screen.getByTestId('install-mine').textContent).toMatch(/Chrome or Edge/);
  });
});

describe('first-run welcome', () => {
  afterEach(cleanup);
  const pack = makePack({ a: 3 });

  function renderEmpty(saved: Pack[] = []) {
    window.location.hash = '#/';
    render(
      <AppProvider store={new MemoryDataStore()} bundledPacks={[]} loadImported={async () => saved} saveImported={async (p) => void saved.push(p)}>
        <App />
      </AppProvider>,
    );
  }

  it('shows the two steps; importing a pack from it lands on Home', async () => {
    renderEmpty();
    expect(await screen.findByTestId('welcome')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Show me how' })).toHaveAttribute('href', '#/install');
    fireEvent.change(screen.getByTestId('welcome-pack-input'), { target: { files: [new File([JSON.stringify(pack)], 'pack.json')] } });
    expect(await screen.findByText('Welcome back')).toBeInTheDocument();
  });

  it('a bad file shows the reason and stays on the welcome screen', async () => {
    renderEmpty();
    await screen.findByTestId('welcome');
    fireEvent.change(screen.getByTestId('welcome-pack-input'), { target: { files: [new File(['{nope'], 'x.json')] } });
    expect((await screen.findByTestId('welcome-error')).textContent).toMatch(/not valid JSON/);
  });

  it('the install-help link routes to the install screen', async () => {
    renderEmpty();
    fireEvent.click(await screen.findByRole('link', { name: 'Show me how' }));
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await waitFor(() => expect(screen.getByTestId('install-help')).toBeInTheDocument());
  });
});
