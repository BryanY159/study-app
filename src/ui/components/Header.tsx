import { useState } from 'react';
import { useApp } from '../../state/AppProvider';
import type { Route } from '../router';

const LINKS = [
  { href: '#/', label: 'Dashboard', match: (p: string) => p === '/' },
  { href: '#/drill', label: 'Drill', match: (p: string) => p.startsWith('/drill') },
  { href: '#/mock', label: 'Mock exam', match: (p: string) => p.startsWith('/mock') },
];

export function Header({ route }: { route: Route }) {
  const { flags } = useApp();
  return (
    <header className="app-header">
      <div className="inner">
        <a className="brand" href="#/">
          Study<span>.</span>
        </a>
        <nav className="nav" aria-label="Main">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className={l.match(route.path) ? 'active' : ''}>
              {l.label}
            </a>
          ))}
          <a href="#/flags" className={route.path === '/flags' ? 'active' : ''}>
            Flagged ({flags.flags.length})
          </a>
          <a href="#/data" className={route.path === '/data' ? 'active' : ''}>
            History &amp; data
          </a>
        </nav>
        <SaveStatusChip />
      </div>
    </header>
  );
}

export type ChipKind = 'folder' | 'saving-folder' | 'browser' | 'reconnect' | 'retrying' | 'failed' | 'newer';

/** Which save state to show, from the folder connection and the last write. */
export function chipKind(a: Pick<ReturnType<typeof useApp>, 'folderState' | 'mirrorStatus' | 'saveStatus'>): ChipKind {
  const m = a.mirrorStatus;
  if (a.saveStatus === 'error' || m?.kind === 'browser-failed') return 'failed';
  if (m?.kind === 'failed') return 'retrying';
  if (a.folderState === 'newer-version' || m?.kind === 'newer-version') return 'newer';
  if (a.folderState === 'needs-permission' || m?.kind === 'lost-access') return 'reconnect';
  if (a.folderState === 'connected') return m?.kind === 'saving' ? 'saving-folder' : 'folder';
  return 'browser';
}

const CHIP_TEXT: Record<ChipKind, string> = {
  folder: 'Saved to data folder',
  'saving-folder': 'Saving to data folder…',
  browser: 'Saved in browser',
  reconnect: 'Saved in browser — reconnect folder',
  retrying: 'Save failed — retrying (safe in browser)',
  failed: 'Save failed — download a backup',
  newer: 'Saved in browser only — update the app',
};

function SaveStatusChip() {
  const app = useApp();
  const [error, setError] = useState('');
  const kind = chipKind(app);
  const bad = kind === 'failed' || kind === 'retrying';
  return (
    <div className="row" style={{ gap: 10 }}>
      <div className={`save-status${bad ? ' error' : ''}`} data-testid="save-status" title={app.mirrorStatus && 'error' in app.mirrorStatus ? app.mirrorStatus.error : undefined}>
        {!bad && kind !== 'reconnect' && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#177245" strokeWidth="2.5" aria-hidden="true">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        )}
        {CHIP_TEXT[kind]}
      </div>
      {kind === 'reconnect' && (
        <button
          type="button"
          className="btn small primary"
          onClick={async () => {
            const r = await app.reconnectFolder();
            setError(r.ok ? '' : r.error);
          }}
        >
          Reconnect data folder
        </button>
      )}
      {error && (
        <span className="small" style={{ color: 'var(--incorrect-ink)' }} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
