import { useRef, useState } from 'react';
import { useApp } from '../../state/AppProvider';
import { useRestore } from '../components/RestoreConfirm';

/** First run: connect the data folder next to index.html, or skip (browser-only saving). */
export function ConnectFolder() {
  const { connectFolder, skipFolder } = useApp();
  const [error, setError] = useState('');
  return (
    <main className="page narrow">
      <section className="card stack-lg" data-testid="connect-folder">
        <h1>Connect your data folder</h1>
        <p>
          Your answers and flags can be saved as files, so they stay safe even if browser data is cleared. This is a one-time step.
        </p>
        <ol className="stack" style={{ margin: 0, paddingLeft: 20, gap: 6 }}>
          <li>
            Click <strong>Choose data folder</strong>.
          </li>
          <li>
            Go to the <strong>StudyApp</strong> folder (where <code>index.html</code> is) and select the folder named <strong>data</strong>.
          </li>
          <li>
            When the browser asks, click <strong>Edit files</strong> / <strong>Allow</strong>.
          </li>
        </ol>
        {error && <div className="banner error">{error}</div>}
        <div className="row">
          <button
            type="button"
            className="btn primary big"
            onClick={async () => {
              const r = await connectFolder();
              setError(r.ok ? '' : r.error);
            }}
          >
            Choose data folder
          </button>
          <button type="button" className="btn" onClick={skipFolder}>
            Skip for now
          </button>
        </div>
        <p className="small muted">If you skip, everything is saved in this browser only. You can connect the folder later from History &amp; data.</p>
      </section>
    </main>
  );
}

/** One-time offer after connecting: bring in a v1 backup file so it moves to the folder. */
export function BackupOffer() {
  const { folderName, dismissBackupOffer, progress, flags } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const restore = useRestore((r) => {
    if (r.ok) dismissBackupOffer();
    else if ('error' in r) setError(r.error);
  });
  const hasProgress = progress.attempts.length > 0 || flags.flags.some((f) => f.source === 'user');
  return (
    <section className="card stack" data-testid="backup-offer">
      <h2>Data folder connected{folderName ? ` (“${folderName}”)` : ''}</h2>
      {folderName && folderName !== 'data' && (
        <div className="banner warn">This folder isn't named “data”. Make sure it's the data folder next to index.html, or change it on the History &amp; data page.</div>
      )}
      <p>
        {hasProgress
          ? 'Your progress in this browser has been copied to the folder. '
          : ''}
        Did you save a <strong>backup file</strong> from the earlier version, or study in another browser? Import it once and it moves into your data folder.
        {hasProgress && ' Importing replaces what is saved now (a safety copy is downloaded first).'}
      </p>
      {error && <div className="banner error">{error}</div>}
      <div className="row">
        <button type="button" className="btn primary" onClick={() => input.current?.click()}>
          Import a backup file…
        </button>
        <button type="button" className="btn" onClick={dismissBackupOffer}>
          No thanks
        </button>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          hidden
          data-testid="offer-backup-input"
          onChange={async (e) => {
            setError('');
            await restore.pick(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
      {restore.panel}
    </section>
  );
}
