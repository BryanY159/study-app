import { useRef, useState } from 'react';
import { sessionScore } from '../../engine/progress';
import { dateStamp, downloadFile, makeBackup } from '../../storage/backup';
import { useApp, type FolderResult } from '../../state/AppProvider';
import { useRestore } from '../components/RestoreConfirm';

/** FR-7 history, FR-8 pack import, FR-9 backup/restore. */
export function DataPage() {
  const { packs, ix, progress, flags, importPack, setActivePack, folderState, folderName, connectFolder, reconnectFolder, disconnectFolder } = useApp();
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const packInput = useRef<HTMLInputElement>(null);
  const backupInput = useRef<HTMLInputElement>(null);

  const runFolder = async (action: () => Promise<FolderResult>) => {
    const r = await action();
    if (!r.ok && r.error) setMsg({ kind: 'error', text: r.error });
  };

  const onPack = async (file: File | undefined) => {
    if (!file) return;
    const r = await importPack(await file.text());
    setMsg(
      r.ok
        ? { kind: 'ok', text: `Imported “${r.pack.title}” v${r.pack.version} (${r.pack.questions.length} questions)${r.replaced !== null ? `, replacing v${r.replaced}. Your progress carries over.` : '.'}` }
        : { kind: 'error', text: r.error },
    );
    if (packInput.current) packInput.current.value = '';
  };

  const restore = useRestore((r) => {
    if (r.ok) setMsg({ kind: 'ok', text: `Restored the backup from ${new Date(r.backup.createdAt).toLocaleString()}.` });
    else if ('error' in r) setMsg({ kind: 'error', text: r.error });
    else setMsg(null);
  });

  const onBackup = async (file: File | undefined) => {
    await restore.pick(file);
    if (backupInput.current) backupInput.current.value = '';
  };

  const sessions = [...progress.sessions].reverse().map((s) => ({ s, score: sessionScore(s, progress.attempts) }));

  return (
    <main className="page narrow">
      <h1>History &amp; data</h1>
      {msg && (
        <div className={`banner ${msg.kind}`} role="status" data-testid="data-message">
          {msg.text}
        </div>
      )}

      <section className="card stack">
        <h2>Backup</h2>
        <p className="muted">
          {folderState === 'connected'
            ? 'Your answers and flags are saved to the data folder, with a copy in this browser. A backup file is still handy for moving to another computer.'
            : 'Your answers and flags are saved in this browser. Clearing browser data would erase them, so connect the data folder or download a backup now and then.'}
        </p>
        <div className="row">
          <button type="button" className="btn primary" onClick={() => downloadFile(`study-backup-${dateStamp()}.json`, JSON.stringify(makeBackup(progress, flags)))}>
            Download backup
          </button>
          <button type="button" className="btn" onClick={() => backupInput.current?.click()}>
            Restore from backup…
          </button>
          <input ref={backupInput} type="file" accept=".json,application/json" hidden data-testid="backup-input" onChange={(e) => onBackup(e.target.files?.[0])} />
        </div>
        {restore.panel}
      </section>

      {folderState !== 'unsupported' && (
        <section className="card stack" data-testid="folder-section">
          <h2>Data folder</h2>
          <p className="muted">
            {folderState === 'connected' && `Connected to “${folderName}”. Every answer and flag is saved to progress.json and flags.json there.`}
            {folderState === 'needs-permission' && `“${folderName}” is remembered but needs one click to reconnect. Until then, everything is saved in this browser and copied over when you reconnect.`}
            {folderState === 'newer-version' &&
              `“${folderName}” has data saved by a newer version of this app, so it is left untouched. Update index.html, then reopen the app. Until then, everything is saved in this browser.`}
            {(folderState === 'skipped' || folderState === 'not-set-up') && 'Not connected. Choose the “data” folder next to index.html to save your work as files.'}
          </p>
          <div className="row">
            {folderState === 'needs-permission' && (
              <button type="button" className="btn primary" onClick={() => runFolder(reconnectFolder)}>
                Reconnect data folder
              </button>
            )}
            <button type="button" className={folderState === 'connected' || folderState === 'needs-permission' ? 'btn' : 'btn primary'} onClick={() => runFolder(connectFolder)}>
              {folderState === 'connected' || folderState === 'needs-permission' ? 'Choose a different folder…' : 'Connect data folder…'}
            </button>
            {(folderState === 'connected' || folderState === 'needs-permission') && (
              <button type="button" className="btn danger" onClick={() => disconnectFolder()}>
                Stop saving to folder
              </button>
            )}
          </div>
        </section>
      )}

      <section className="card stack">
        <h2>Question packs</h2>
        {packs.map((p) => (
          <div key={p.packId} className="list-row">
            <div>
              <div style={{ fontWeight: 600 }}>{p.title}</div>
              <div className="small muted">
                {p.packId} · version {p.version} · {p.questions.length} questions
              </div>
            </div>
            {ix?.pack.packId === p.packId ? (
              <span className="chip accent">In use</span>
            ) : (
              <button type="button" className="btn small" onClick={() => setActivePack(p.packId)}>
                Use this pack
              </button>
            )}
          </div>
        ))}
        <div className="row">
          <button type="button" className="btn" onClick={() => packInput.current?.click()}>
            Import pack…
          </button>
          <input ref={packInput} type="file" accept=".json,application/json" hidden data-testid="pack-input" onChange={(e) => onPack(e.target.files?.[0])} />
        </div>
      </section>

      <section className="card stack">
        <h2>Session history</h2>
        {sessions.length === 0 && <p className="muted">No sessions yet.</p>}
        {sessions.map(({ s, score }) => (
          <div key={s.id} className="list-row">
            <div>
              <div style={{ fontWeight: 500 }}>{s.mode === 'mock' && s.endedAt ? <a href={`#/mock/results/${s.id}`}>{s.label}</a> : s.label}</div>
              <div className="small muted">
                {new Date(s.startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                {!s.endedAt && ' · not finished'}
              </div>
            </div>
            <span style={{ fontWeight: 600 }}>
              {score.correct}/{score.total}
            </span>
          </div>
        ))}
      </section>
    </main>
  );
}
