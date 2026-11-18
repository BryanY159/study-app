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

export type ChipKind = 'saved' | 'saving' | 'failed' | 'newer';

/** Which save state to show, from the last write. */
export function chipKind(a: Pick<ReturnType<typeof useApp>, 'saveStatus' | 'newerVersionData'>): ChipKind {
  if (a.saveStatus === 'error') return 'failed';
  if (a.newerVersionData) return 'newer';
  return a.saveStatus === 'saving' ? 'saving' : 'saved';
}

const CHIP_TEXT: Record<ChipKind, string> = {
  saved: 'Saved on this device',
  saving: 'Saving…',
  failed: 'Save failed — export a sync file',
  newer: 'Some data is from a newer version — reload',
};

function SaveStatusChip() {
  const app = useApp();
  const kind = chipKind(app);
  const bad = kind === 'failed';
  return (
    <div className={bad ? 'save-status error' : 'save-status'} data-testid="save-status">
      {kind === 'saved' && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#177245" strokeWidth="2.5" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      )}
      {CHIP_TEXT[kind]}
    </div>
  );
}
