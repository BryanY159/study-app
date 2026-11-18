import { useEffect, useRef, useState } from 'react';
import type { Question } from '../../pack/schema';
import { FLAG_REASONS, type FlagReason } from '../../storage/docs';

const REASON_TEXT: Record<FlagReason, string> = {
  'answer-wrong': 'The marked answer seems wrong',
  'explanation-wrong': 'The explanation seems wrong',
  unclear: 'The question is unclear',
  typo: 'Typo',
  other: 'Other',
};

interface Props {
  question: Question;
  initial?: { reason: FlagReason; comment: string };
  onSave: (reason: FlagReason, comment: string) => void;
  onClose: () => void;
}

export function FlagDialog({ question, initial, onSave, onClose }: Props) {
  const [reason, setReason] = useState<FlagReason>(initial?.reason ?? 'answer-wrong');
  const [comment, setComment] = useState(initial?.comment ?? '');
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="flag-title"
        // Keys typed here must not answer the question underneath.
        onKeyDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSave(reason, comment.trim());
        }}
      >
        <div className="spread">
          <h2 id="flag-title">{initial ? 'Edit flag' : 'Flag this question'}</h2>
          <button type="button" className="btn small" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="muted small">
          {question.id} · {question.stem.length > 90 ? question.stem.slice(0, 90) + '…' : question.stem}
        </p>
        <fieldset>
          <legend>What's wrong?</legend>
          {FLAG_REASONS.map((r, i) => (
            <label key={r} className="check">
              <input ref={i === 0 ? first : undefined} type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} />
              {REASON_TEXT[r]}
            </label>
          ))}
        </fieldset>
        <label className="stack" style={{ gap: 6 }}>
          <span>Note (optional)</span>
          <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="What did you expect, or what does the lecture say?" />
        </label>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Save flag
          </button>
        </div>
      </form>
    </div>
  );
}
