import { downloadFile } from '../../storage/backup';
import { useApp } from '../../state/AppProvider';

/** Saved data that couldn't be read: it wasn't used, a copy was kept, and she can download it. */
export function SetAsideWarning() {
  const { setAside } = useApp();
  if (!setAside.length) return null;
  return (
    <div className="banner warn stack" data-testid="set-aside">
      {setAside.map((c) => (
        <div key={`${c.where}-${c.name}`}>
          Your saved {c.doc === 'progress' ? 'progress' : 'flags'}
          {c.where === 'legacy' ? ' from the previous version of the app' : ''} couldn't be read ({c.reason}), so it wasn't used. A copy was kept on this device as{' '}
          <code>{c.name}</code>.{' '}
          <button type="button" className="btn small" onClick={() => downloadFile(c.name, c.text)}>
            Download the copy
          </button>
        </div>
      ))}
      <div>If anything is missing, import a sync file or backup on the History &amp; data page.</div>
    </div>
  );
}
