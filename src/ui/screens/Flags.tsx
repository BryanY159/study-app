import { useState } from 'react';
import { flagState, flagsToJson, flagsToMarkdown, REASON_LABEL } from '../../engine/flags';
import { cardsOf, type Flashcard, type Question } from '../../pack/schema';
import type { Flag } from '../../storage/docs';
import { downloadFile } from '../../storage/backup';
import { dateStamp } from '../../storage/syncFile';
import { useApp } from '../../state/AppProvider';
import { CardFace } from '../components/CardFace';
import { FlagDialog, type FlagItem } from '../components/FlagDialog';
import { KeyIdea, OptionFeedback, QuestionMeta, Stem } from '../components/QuestionView';

type Kind = 'all' | 'question' | 'card';

/** FR-6: list, edit, remove, and export flags, on questions and on flashcards. */
export function Flags() {
  const { flags, packs, ix, updateFlag, removeFlag } = useApp();
  const [tab, setTab] = useState<'open' | 'resolved'>('open');
  const [kind, setKind] = useState<Kind>('all');
  const [editing, setEditing] = useState<{ flag: Flag; item: FlagItem } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const withState = flags.flags.filter((f) => kind === 'all' || f.itemType === kind).map((f) => ({ f, state: flagState(f, packs) }));
  const open = withState.filter((x) => x.state !== 'resolved');
  const resolved = withState.filter((x) => x.state === 'resolved');
  const shown = (tab === 'open' ? open : resolved).slice().reverse();
  const hasCards = flags.flags.some((f) => f.itemType === 'card');

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
            Questions{hasCards ? ' and cards' : ''} you reported. Export them to get the pack fixed.
          </p>
        </div>
        <button type="button" className="btn" onClick={exportFlags} disabled={!flags.flags.length}>
          Export flags for review
        </button>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <div className="row" role="tablist" aria-label="Open or resolved" style={{ gap: 8 }}>
          <button type="button" role="tab" className="btn seg" aria-selected={tab === 'open'} onClick={() => setTab('open')}>
            Open {open.length}
          </button>
          <button type="button" role="tab" className="btn seg" aria-selected={tab === 'resolved'} onClick={() => setTab('resolved')}>
            Resolved {resolved.length}
          </button>
        </div>
        {hasCards && (
          <div className="row" role="group" aria-label="Questions or cards" style={{ gap: 8 }}>
            {(
              [
                ['all', 'All'],
                ['question', 'Questions'],
                ['card', 'Cards'],
              ] as const
            ).map(([k, label]) => (
              <button key={k} type="button" className="btn seg" aria-pressed={kind === k} onClick={() => setKind(k)}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      {shown.length === 0 && <div className="card empty">{tab === 'open' ? 'No open flags. Use the Flag button on any question or card.' : 'Nothing resolved yet.'}</div>}
      {shown.map(({ f, state }) => {
        const pack = packs.find((p) => p.packId === f.packId);
        const card: Flashcard | undefined = f.itemType === 'card' && pack ? cardsOf(pack).find((x) => x.id === f.questionId) : undefined;
        const q: Question | undefined = f.itemType === 'question' ? pack?.questions.find((x) => x.id === f.questionId) : undefined;
        const found = card ?? q;
        const item: FlagItem | null = card ? { kind: 'card', id: card.id, text: card.front } : q ? { kind: 'question', id: q.id, text: q.stem } : null;
        const noun = f.itemType === 'card' ? 'card' : 'question';
        return (
          <article key={f.id} className="card stack" data-testid="flag-item" data-kind={f.itemType}>
            <div className="row" style={{ gap: 8 }}>
              <span className={`chip ${state === 'resolved' ? 'ok' : state === 'missing' ? 'bad' : 'warn'}`}>
                {state === 'resolved' ? 'Resolved — re-check' : state === 'missing' ? `${noun === 'card' ? 'Card' : 'Question'} removed` : 'Open'}
              </span>
              {f.itemType === 'card' && <span className="chip accent">Card</span>}
              {f.source === 'preflag' && <span className="chip practice">Pre-flagged</span>}
              <span className="chip">{REASON_LABEL[f.reason]}</span>
              <span className="small muted">
                {f.questionId} · flagged during {f.mode}
              </span>
              <span className="grow" />
              <span className="small muted">{new Date(f.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
            </div>
            <p>{card ? card.front : q ? q.stem : `(This ${noun} is no longer in the pack.)`}</p>
            {f.source === 'preflag' && found?.preflag && (
              <p className="small">
                <strong>Why it is unconfirmed: </strong>
                {found.preflag.note}
              </p>
            )}
            <p className="small">
              <strong>{f.source === 'preflag' ? 'Your comment: ' : 'Note: '}</strong>
              {f.comment || <span className="muted">(none)</span>}
            </p>
            <div className="row" style={{ gap: 8 }}>
              {found && (
                <button type="button" className="btn small" onClick={() => setOpenId(openId === f.id ? null : f.id)}>
                  {openId === f.id ? `Hide ${noun}` : `Open ${noun}`}
                </button>
              )}
              {item && (
                <button type="button" className="btn small" onClick={() => setEditing({ flag: f, item })}>
                  {f.source === 'preflag' ? (f.comment ? 'Edit comment' : 'Add comment') : 'Edit note'}
                </button>
              )}
              {f.source !== 'preflag' && (
                <button type="button" className="btn small danger" onClick={() => removeFlag(f.id)}>
                  Remove flag
                </button>
              )}
            </div>
            {openId === f.id && q && ix && ix.pack.packId === f.packId && (
              <div className="stack-lg" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                <QuestionMeta q={q} ix={ix} />
                <Stem q={q} ix={ix} />
                <OptionFeedback q={q} chosen={[]} />
                <KeyIdea q={q} />
              </div>
            )}
            {openId === f.id && card && ix && ix.pack.packId === f.packId && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                <CardFace card={card} topicName={ix.topic.get(card.topicIds[0])?.name ?? ''} flipped />
              </div>
            )}
          </article>
        );
      })}
      {editing && (
        <FlagDialog
          item={editing.item}
          initial={{ reason: editing.flag.reason, comment: editing.flag.comment }}
          onClose={() => setEditing(null)}
          onSave={(reason, comment) => {
            updateFlag(editing.flag.id, { reason, comment });
            setEditing(null);
          }}
        />
      )}
    </main>
  );
}
