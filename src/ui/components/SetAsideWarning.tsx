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
          Your saved {c.doc === 'progress' ? 'progress' : 'flags'} in the {c.where === 'folder' ? 'data folder' : 'browser'} couldn't be read ({c.reason}), so it wasn't used. A
          copy was kept as <code>{c.name}</code>
          {c.where === 'folder' ? ' in the data folder' : ' in this browser'}.{' '}
          <button type="button" className="btn small" onClick={() => downloadFile(c.name, c.text)}>
            Download the copy
          </button>
        </div>
      ))}
      <div>If the other copy is also missing things, restore a backup on the History &amp; data page.</div>
    </div>
  );
}
