import { useState } from 'react';
import { deliverFile, type Delivery } from '../../storage/backup';
import { reminderDue, snoozeUntil } from '../../storage/reminder';
import { cleanLabel, makeSyncFile, MAX_LABEL, syncFileName } from '../../storage/syncFile';
import { useApp } from '../../state/AppProvider';

const SUGGESTIONS = ['Phone', 'Tablet', 'Laptop'];

/**
 * "Export sync file". The first time, it asks for a name for this device; that
 * name goes into every file this device exports, so imports can say where a file came from.
 */
export function ExportButton({ text = 'Export sync file', primary = true, onDone }: { text?: string; primary?: boolean; onDone?: (r: Delivery, name: string) => void }) {
  const { progress, flags, cards, meta, setDeviceLabel, markExported, shareEnv, now } = useApp();
  const [asking, setAsking] = useState(false);
  const [draft, setDraft] = useState('');

  // Runs straight from a click: the file is built before the first await, so iOS still opens the Share sheet.
  const run = (label: string) => {
    const at = now();
    const name = syncFileName(label, at);
    const text = JSON.stringify(makeSyncFile(progress, flags, { device: label, cards, now: at }));
    void deliverFile(name, text, shareEnv).then((r) => {
      if (r !== 'cancelled') markExported();
      onDone?.(r, name);
    });
  };

  if (asking) {
    const clean = cleanLabel(draft);
    return (
      <form
        className="stack"
        data-testid="label-prompt"
        onSubmit={(e) => {
          e.preventDefault();
          if (!clean) return;
          setDeviceLabel(clean);
          setAsking(false);
          run(clean);
        }}
      >
        <label className="stack" style={{ gap: 6 }}>
          <span>Name this device first. The name goes into each file it exports, so you can tell your devices apart.</span>
          <input className="text-input" value={draft} maxLength={MAX_LABEL} onChange={(e) => setDraft(e.target.value)} placeholder="e.g. Phone" aria-label="Device name" autoFocus />
        </label>
        <div className="row">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="btn small seg" aria-pressed={clean === s} onClick={() => setDraft(s)}>
              {s}
            </button>
          ))}
        </div>
        <div className="row">
          <button type="submit" className="btn primary" disabled={!clean}>
            Save name and export
          </button>
          <button type="button" className="btn" onClick={() => setAsking(false)}>
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <button type="button" className={primary ? 'btn primary' : 'btn'} onClick={() => (meta.deviceLabel ? run(meta.deviceLabel) : setAsking(true))}>
      {text}
    </button>
  );
}

/** Soft reminder on Home when this device hasn't exported a sync file for a while. */
export function BackupReminder() {
  const { progress, meta, now, snoozeReminder } = useApp();
  const due = reminderDue({ answers: progress.attempts.length, lastExportAt: meta.lastExportAt, snoozedUntil: meta.reminderSnoozedUntil, now: now() });
  if (!due) return null;
  return (
    <div className="banner warn reminder" role="status" data-testid="backup-reminder">
      <span>
        {due.daysSince === null ? "You haven't exported a sync file from this device yet." : `Last sync file from this device: ${due.daysSince} days ago.`} Export one to keep a
        copy of your answers off this device.
      </span>
      <span className="row" style={{ gap: 8 }}>
        <ExportButton text="Export now" />
        <button type="button" className="btn small" onClick={() => snoozeReminder(snoozeUntil(now()))}>
          Not today
        </button>
      </span>
    </div>
  );
}
