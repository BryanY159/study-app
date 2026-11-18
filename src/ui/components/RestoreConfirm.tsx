import { useState } from 'react';
import { backupCounts, downloadFile, makeBackup, parseBackup, type Backup } from '../../storage/backup';
import { useApp } from '../../state/AppProvider';

const fileStamp = (d = new Date()) => d.toISOString().slice(0, 19).replace(/[:T]/g, '-');

/**
 * Restoring replaces everything, so: first a safety backup of the current data
 * is downloaded automatically, then she confirms after seeing both sets of counts.
 */
export function useRestore(onDone: (r: { ok: true; backup: Backup } | { ok: false; error: string } | { ok: false; cancelled: true }) => void) {
  const { progress, flags, restoreBackup } = useApp();
  const [pending, setPending] = useState<{ backup: Backup; safetyName: string } | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    const r = parseBackup(await file.text());
    if (!r.ok) return onDone(r);
    const safetyName = `study-backup-before-restore-${fileStamp()}.json`;
    downloadFile(safetyName, JSON.stringify(makeBackup(progress, flags)));
    setPending({ backup: r.backup, safetyName });
  };

  const now = backupCounts({ progress, flags });
  const panel = pending && (
    <section className="card stack" role="dialog" aria-label="Confirm restore" data-testid="restore-confirm">
      <h2>Replace your data with this backup?</h2>
      <p className="small">
        A safety copy of your current data was downloaded first (<code>{pending.safetyName}</code>), so you can undo this by restoring that file.
      </p>
      <table className="confirm-table">
        <thead>
          <tr>
            <th />
            <th>Answers</th>
            <th>Flags</th>
          </tr>
        </thead>
        <tbody>
          <tr data-testid="restore-current">
            <td>Your data now</td>
            <td>{now.attempts}</td>
            <td>{now.flags}</td>
          </tr>
          <tr data-testid="restore-backup">
            <td>Backup from {new Date(pending.backup.createdAt).toLocaleString()}</td>
            <td>{backupCounts(pending.backup).attempts}</td>
            <td>{backupCounts(pending.backup).flags}</td>
          </tr>
        </tbody>
      </table>
      {backupCounts(pending.backup).attempts < now.attempts && (
        <div className="banner warn">This backup has fewer answers than you have now. Anything not in the backup will be replaced (it stays in the safety copy).</div>
      )}
      <div className="row">
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            restoreBackup(pending.backup);
            setPending(null);
            onDone({ ok: true, backup: pending.backup });
          }}
        >
          Replace with backup
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setPending(null);
            onDone({ ok: false, cancelled: true });
          }}
        >
          Cancel
        </button>
      </div>
    </section>
  );

  return { pick, panel };
}
