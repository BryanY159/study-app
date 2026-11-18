import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../state/AppProvider';
import type { Route } from '../router';
import { useBreakpoint } from '../useBreakpoint';

const LINKS = [
  { href: '#/', label: 'Dashboard', match: (p: string) => p === '/' },
  { href: '#/cards', label: 'Cards', match: (p: string) => p.startsWith('/cards') },
  { href: '#/drill', label: 'Drill', match: (p: string) => p.startsWith('/drill') },
  { href: '#/mock', label: 'Mock exam', match: (p: string) => p.startsWith('/mock') },
];

/**
 * Tablet and laptop: the top navigation bar (as in v1).
 * Phone: a compact header (brand + save status); navigation moves to the bottom tab bar.
 */
export function Header({ route }: { route: Route }) {
  const { flags } = useApp();
  const phone = useBreakpoint() === 'phone';
  return (
    <header className={phone ? 'app-header compact' : 'app-header'}>
      <div className="inner">
        <a className="brand" href="#/">
          Study<span>.</span>
        </a>
        {!phone && (
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
        )}
        {phone && <span className="grow" />}
        <SaveStatusChip />
      </div>
    </header>
  );
}

const TAB_ICONS = {
  home: 'M3 11l9-8 9 8M5 10v10h14V10',
  cards: 'M4 6h12v14H4zM8 3h12v14',
  drill: 'M9 11l3 3 8-8M20 12v7H4V5h11',
  mock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  more: 'M4 6h16M4 12h16M4 18h16',
};

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

/** Phone only: Home · Cards · Drill · Mock · More (Flagged, History & data, Install help). */
export function TabBar({ route }: { route: Route }) {
  const { flags } = useApp();
  const [more, setMore] = useState(false);
  const p = route.path;
  const inMore = p === '/flags' || p === '/data' || p === '/install';
  useEffect(() => {
    document.body.classList.add('has-tabbar');
    return () => document.body.classList.remove('has-tabbar');
  }, []);
  useEffect(() => setMore(false), [p]);
  const tab = (href: string, label: string, d: string, active: boolean) => (
    <a href={href} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined}>
      <Icon d={d} />
      {label}
    </a>
  );
  return (
    <>
      <nav className="tabbar" aria-label="Main" data-testid="tabbar">
        {tab('#/', 'Home', TAB_ICONS.home, p === '/' || p === '')}
        {tab('#/cards', 'Cards', TAB_ICONS.cards, p.startsWith('/cards'))}
        {tab('#/drill', 'Drill', TAB_ICONS.drill, p.startsWith('/drill'))}
        {tab('#/mock', 'Mock', TAB_ICONS.mock, p.startsWith('/mock'))}
        <button type="button" className={inMore ? 'active' : ''} aria-haspopup="dialog" aria-expanded={more} onClick={() => setMore(true)}>
          <Icon d={TAB_ICONS.more} />
          More
        </button>
      </nav>
      {more && <MoreSheet flagCount={flags.flags.length} onClose={() => setMore(false)} />}
    </>
  );
}

function MoreSheet({ flagCount, onClose }: { flagCount: number; onClose: () => void }) {
  const first = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose} data-testid="more-sheet">
      <div className="sheet" role="dialog" aria-modal="true" aria-label="More" onClick={(e) => e.stopPropagation()}>
        <div className="grabber" aria-hidden="true" />
        <a ref={first} href="#/flags">
          Flagged <span className="muted">{flagCount}</span>
        </a>
        <a href="#/data">History &amp; data</a>
        <a href="#/install">Install help</a>
        <button type="button" className="btn" style={{ marginTop: 8 }} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
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
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="ok-ink" strokeWidth="2.5" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      )}
      {CHIP_TEXT[kind]}
    </div>
  );
}
