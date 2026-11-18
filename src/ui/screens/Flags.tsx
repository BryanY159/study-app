import { useState } from 'react';
import { flagState, flagsToJson, flagsToMarkdown, REASON_LABEL } from '../../engine/flags';
import type { Flag } from '../../storage/docs';
import { downloadFile } from '../../storage/backup';
import { dateStamp } from '../../storage/syncFile';
import { useApp } from '../../state/AppProvider';
import { FlagDialog } from '../components/FlagDialog';
import { KeyIdea, OptionFeedback, QuestionMeta, Stem } from '../components/QuestionView';

/** FR-6: list, edit, remove, and export flags. */
export function Flags() {
  const { flags, packs, ix, updateFlag, removeFlag } = useApp();
  const [tab, setTab] = useState<'open' | 'resolved'>('open');
  const [editing, setEditing] = useState<Flag | null>(null);
  const [openQ, setOpenQ] = useState<string | null>(null);

  const withState = flags.flags.map((f) => ({ f, state: flagState(f, packs) }));
  const open = withState.filter((x) => x.state !== 'resolved');
  const resolved = withState.filter((x) => x.state === 'resolved');
  const shown = (tab === 'open' ? open : resolved).slice().reverse();

  const exportFlags = () => {
    const stamp = dateStamp();
    downloadFile(`flags-${stamp}.json`, flagsToJson(flags.flags, packs));
    downloadFile(`flags-${stamp}.md`, flagsToMarkdown(flags.flags, packs), 'text/markdown');
  };

  return (
    <main className="page narrow">
      <div className="spread">
        <div>
          <h1>Flagged questions</h1>
          <p className="muted" style={{ marginTop: 6 }}>
            Questions you reported. Export them to get the pack fixed.
          </p>
        </div>
        <button type="button" className="btn" onClick={exportFlags} disabled={!flags.flags.length}>
          Export flags for review
        </button>
      </div>
      <div className="row" role="tablist" aria-label="Filter flags" style={{ gap: 8 }}>
        <button type="button" role="tab" className="btn seg" aria-selected={tab === 'open'} onClick={() => setTab('open')}>
          Open {open.length}
        </button>
        <button type="button" role="tab" className="btn seg" aria-selected={tab === 'resolved'} onClick={() => setTab('resolved')}>
          Resolved {resolved.length}
        </button>
      </div>
      {shown.length === 0 && <div className="card empty">{tab === 'open' ? 'No open flags. Use the Flag button on any question.' : 'Nothing resolved yet.'}</div>}
      {shown.map(({ f, state }) => {
        const pack = packs.find((p) => p.packId === f.packId);
        const q = pack?.questions.find((x) => x.id === f.questionId);
        return (
          <article key={f.id} className="card stack" data-testid="flag-item">
            <div className="row" style={{ gap: 8 }}>
              <span className={`chip ${state === 'resolved' ? 'ok' : state === 'missing' ? 'bad' : 'warn'}`}>
                {state === 'resolved' ? 'Resolved — re-check' : state === 'missing' ? 'Question removed' : 'Open'}
              </span>
              {f.source === 'preflag' && <span className="chip practice">Pre-flagged</span>}
              <span className="chip">{REASON_LABEL[f.reason]}</span>
              <span className="small muted">
                {f.questionId} · flagged during {f.mode}
              </span>
              <span className="grow" />
              <span className="small muted">{new Date(f.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
            </div>
            <p>{q ? q.stem : '(This question is no longer in the pack.)'}</p>
            {f.source === 'preflag' && q?.preflag && (
              <p className="small">
                <strong>Why it is unconfirmed: </strong>
                {q.preflag.note}
              </p>
            )}
            <p className="small">
              <strong>{f.source === 'preflag' ? 'Your comment: ' : 'Note: '}</strong>
              {f.comment || <span className="muted">(none)</span>}
            </p>
            <div className="row" style={{ gap: 8 }}>
              {q && (
                <button type="button" className="btn small" onClick={() => setOpenQ(openQ === f.id ? null : f.id)}>
                  {openQ === f.id ? 'Hide question' : 'Open question'}
                </button>
              )}
              {q && (
                <button type="button" className="btn small" onClick={() => setEditing(f)}>
                  {f.source === 'preflag' ? (f.comment ? 'Edit comment' : 'Add comment') : 'Edit note'}
                </button>
              )}
              {f.source !== 'preflag' && (
                <button type="button" className="btn small danger" onClick={() => removeFlag(f.id)}>
                  Remove flag
                </button>
              )}
            </div>
            {openQ === f.id && q && ix && ix.pack.packId === f.packId && (
              <div className="stack-lg" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                <QuestionMeta q={q} ix={ix} />
                <Stem q={q} ix={ix} />
                <OptionFeedback q={q} chosen={[]} />
                <KeyIdea q={q} />
              </div>
            )}
          </article>
        );
      })}
      {editing && (
        <FlagDialog
          question={packs.find((p) => p.packId === editing.packId)!.questions.find((q) => q.id === editing.questionId)!}
          initial={{ reason: editing.reason, comment: editing.comment }}
          onClose={() => setEditing(null)}
          onSave={(reason, comment) => {
            updateFlag(editing.id, { reason, comment });
            setEditing(null);
          }}
        />
      )}
    </main>
  );
}
