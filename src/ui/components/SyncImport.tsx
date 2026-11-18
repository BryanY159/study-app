import { useState } from 'react';
import { deliverFile } from '../../storage/backup';
import { nothingNew, previewMerge, type MergePreview } from '../../storage/sync';
import { fileCounts, makeSyncFile, parseSyncFile, type SyncFile } from '../../storage/syncFile';
import { useApp } from '../../state/AppProvider';

const fileStamp = (d = new Date()) => d.toISOString().slice(0, 19).replace(/[:T]/g, '-');

export type ImportResult = { ok: true; how: 'merge' | 'replace'; file: SyncFile } | { ok: false; error: string } | { ok: false; cancelled: true };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The preview lines for a Merge, e.g. "+3 answers", "1 flag removed". */
export function previewLines(p: MergePreview): string[] {
  return [
    p.answers && `+${plural(p.answers, 'answer')}`,
    p.sessions && `+${plural(p.sessions, 'session')}`,
    p.flagsAdded && `+${plural(p.flagsAdded, 'flag')}`,
    p.flagsUpdated && `${plural(p.flagsUpdated, 'flag')} updated`,
    p.flagsRemoved && `${plural(p.flagsRemoved, 'flag')} removed (deleted on the other device)`,
    p.cardReviews && `${plural(p.cardReviews, 'card review')}`,
  ].filter((x): x is string => !!x);
}

/**
 * Import sync file: Merge (default) adds what the file has, after showing what
 * will be added. Replace makes this device's data the file's: a safety copy of
 * the current data is saved first, then she confirms after seeing both counts.
 */
export function useSyncImport(onDone: (r: ImportResult) => void) {
  const { progress, flags, cards, restoreBackup, mergeSyncFile, meta, shareEnv, now } = useApp();
  const [pending, setPending] = useState<{ file: SyncFile; upgradedFrom: number | null; how: 'merge' | 'replace'; safetyName: string | null } | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (progress.activeMock) return onDone({ ok: false, error: 'A mock exam is in progress. Submit it (or finish it) before importing a sync file.' });
    const r = parseSyncFile(await file.text());
    if (!r.ok) return onDone(r);
    setPending({ file: r.file, upgradedFrom: r.upgradedFrom, how: 'merge', safetyName: null });
  };

  const close = (r: ImportResult) => {
    setPending(null);
    onDone(r);
  };

  if (!pending) return { pick, panel: null };

  const { file } = pending;
  const preview = previewMerge({ progress, flags, cards }, file);
  const lines = previewLines(preview);
  const here = fileCounts({ progress, flags, cards });
  const there = fileCounts(file);
  const from = `${file.device ? `“${file.device}”` : 'a device with no name'}, exported ${new Date(file.createdAt).toLocaleString()}`;

  const startReplace = () => {
    // Straight from the click, so the Share sheet may open on a phone.
    const name = `study-sync-before-replace-${fileStamp(now())}.json`;
    void deliverFile(name, JSON.stringify(makeSyncFile(progress, flags, { device: meta.deviceLabel ?? '', cards, now: now() })), shareEnv);
    setPending({ ...pending, safetyName: name });
  };

  const panel = (
    <section className="card stack" role="dialog" aria-label="Import sync file" data-testid="sync-import">
      <h2>Import sync file</h2>
      <p className="small muted" data-testid="sync-from">
        From {from}.{pending.upgradedFrom !== null && ' This file is from an older version of the app; it was upgraded and can be used like any sync file.'}
      </p>

      {!pending.safetyName && (
        <div className="stack" role="radiogroup" aria-label="How to import">
          <label className="choice">
            <input type="radio" name="sync-how" checked={pending.how === 'merge'} onChange={() => setPending({ ...pending, how: 'merge' })} />
            <span>
              <strong>Merge</strong> (recommended)
              <br />
              <span className="small muted">Adds the answers and flags this device doesn't have yet. Nothing here is lost, except flags deleted on the other device.</span>
            </span>
          </label>
          <label className="choice">
            <input type="radio" name="sync-how" checked={pending.how === 'replace'} onChange={() => setPending({ ...pending, how: 'replace' })} />
            <span>
              <strong>Replace</strong>
              <br />
              <span className="small muted">Makes this device's data exactly the file's. A safety copy of the current data is saved first.</span>
            </span>
          </label>
        </div>
      )}

      {pending.how === 'merge' && (
        <>
          <div data-testid="merge-preview">
            {nothingNew(preview) ? (
              <p>This file has nothing this device doesn't already have.</p>
            ) : (
              <>
                <p>Merging will add:</p>
                <ul className="preview-list">
                  {lines.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <div className="row">
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                mergeSyncFile(file);
                close({ ok: true, how: 'merge', file });
              }}
            >
              Merge
            </button>
            <button type="button" className="btn" onClick={() => close({ ok: false, cancelled: true })}>
              Cancel
            </button>
          </div>
        </>
      )}

      {pending.how === 'replace' && !pending.safetyName && (
        <div className="row">
          <button type="button" className="btn primary" onClick={startReplace}>
            Save a safety copy and continue
          </button>
          <button type="button" className="btn" onClick={() => close({ ok: false, cancelled: true })}>
            Cancel
          </button>
        </div>
      )}

      {pending.how === 'replace' && pending.safetyName && (
        <div className="stack" data-testid="restore-confirm">
          <h3>Replace this device's data with the file?</h3>
          <p className="small">
            A safety copy of the current data was saved first (<code>{pending.safetyName}</code>), so you can undo this by importing that file with Replace.
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
                <td className="row-head">This device now</td>
                <td data-label="Answers">{here.attempts}</td>
                <td data-label="Flags">{here.flags}</td>
              </tr>
              <tr data-testid="restore-backup">
                <td className="row-head">The file</td>
                <td data-label="Answers">{there.attempts}</td>
                <td data-label="Flags">{there.flags}</td>
              </tr>
            </tbody>
          </table>
          {there.attempts < here.attempts && (
            <div className="banner warn">The file has fewer answers than this device. Anything not in the file will be replaced (it stays in the safety copy).</div>
          )}
          <div className="row">
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                restoreBackup(file);
                close({ ok: true, how: 'replace', file });
              }}
            >
              Replace with this file
            </button>
            <button type="button" className="btn" onClick={() => close({ ok: false, cancelled: true })}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );

  return { pick, panel };
}
