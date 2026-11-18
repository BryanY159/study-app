import { useRef, useState } from 'react';
import { sessionScore } from '../../engine/progress';
import { cleanLabel, MAX_LABEL } from '../../storage/syncFile';
import { useApp } from '../../state/AppProvider';
import { ExportButton } from '../components/SyncExport';
import { useSyncImport } from '../components/SyncImport';

/** FR-7 history, FR-8 pack import, sync export/import (backup and moving between devices). */
export function DataPage() {
  const { packs, ix, progress, importPack, setActivePack, meta, persistence } = useApp();
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const packInput = useRef<HTMLInputElement>(null);
  const syncInput = useRef<HTMLInputElement>(null);

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

  const sync = useSyncImport((r) => {
    if (r.ok) setMsg({ kind: 'ok', text: r.how === 'merge' ? 'Merged the sync file into this device.' : 'Replaced this device’s data with the file.' });
    else if ('error' in r) setMsg({ kind: 'error', text: r.error });
    else setMsg(null);
  });

  const onSyncFile = async (file: File | undefined) => {
    setMsg(null);
    await sync.pick(file);
    if (syncInput.current) syncInput.current.value = '';
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

      <section className="card stack" data-testid="sync-section">
        <h2>Sync &amp; backup</h2>
        <p className="muted">
          Your answers and flags are saved on this device only. To use another device, or to keep a backup, export a sync file and import it on the other device with
          Merge.
        </p>
        <p className="small" data-testid="storage-persistence">
          {persistence === 'persistent' && 'Storage: persistent. The browser has agreed not to clear this data on its own.'}
          {persistence === 'not-persistent' && 'Storage: not guaranteed. The browser may clear this data if the device runs low on space, so export a sync file regularly.'}
          {(persistence === 'unknown' || persistence === null) && "Storage: this browser didn't say whether it keeps this data. Export a sync file regularly to be safe."}
        </p>
        <DeviceLabel />
        <p className="small muted" data-testid="last-export">
          {meta.lastExportAt ? `Last export from this device: ${new Date(meta.lastExportAt).toLocaleString()}.` : 'No sync file exported from this device yet.'}
        </p>
        <div className="row">
          <ExportButton onDone={(r, name) => r !== 'cancelled' && setMsg({ kind: 'ok', text: r === 'shared' ? `Shared ${name}.` : `Saved ${name} to your downloads.` })} />
          <button type="button" className="btn" onClick={() => syncInput.current?.click()}>
            Import sync file…
          </button>
          <input ref={syncInput} type="file" accept=".json,application/json" hidden data-testid="sync-input" onChange={(e) => onSyncFile(e.target.files?.[0])} />
        </div>
        {sync.panel}
      </section>

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

/** "This device: Laptop  [Rename]". The name is device-local and never synced. */
function DeviceLabel() {
  const { meta, setDeviceLabel } = useApp();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  if (editing) {
    return (
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          setDeviceLabel(draft);
          setEditing(false);
        }}
      >
        <input className="text-input" value={draft} maxLength={MAX_LABEL} onChange={(e) => setDraft(e.target.value)} aria-label="Device name" autoFocus />
        <button type="submit" className="btn small primary" disabled={!cleanLabel(draft)}>
          Save
        </button>
        <button type="button" className="btn small" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </form>
    );
  }
  return (
    <div className="row" data-testid="device-label">
      <span>
        This device: <strong>{meta.deviceLabel ?? 'not named yet'}</strong>
      </span>
      <button
        type="button"
        className="btn small"
        onClick={() => {
          setDraft(meta.deviceLabel ?? '');
          setEditing(true);
        }}
      >
        {meta.deviceLabel ? 'Rename' : 'Name this device'}
      </button>
    </div>
  );
}
