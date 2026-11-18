import { useCallback, useEffect, useRef } from 'react';
import { isCorrect } from '../../engine/scoring';
import { newId, useApp } from '../../state/AppProvider';
import { FlagButton, KeyIdea, OptionFeedback, OptionPicker, QuestionMeta, Stem } from '../components/QuestionView';
import { useFlag } from '../components/useFlag';
import { navigate } from '../router';

/** FR-2: one question at a time, feedback right after answering. */
export function DrillRun() {
  const { ix, drill, setDrill, recordAttempts, endSession, progress } = useApp();
  const shownAt = useRef(Date.now());
  const qid = drill?.questionIds[drill.index];
  const q = qid ? ix?.question.get(qid) : undefined;
  const chosen = qid ? drill?.answers[qid] : undefined;
  const flag = useFlag(q, 'drill');

  useEffect(() => {
    shownAt.current = Date.now();
  }, [qid]);

  const answer = useCallback(
    (key: string) => {
      if (!drill || !q || !ix || chosen) return;
      const pick = [key];
      // Saved immediately, so ending early or closing the tab keeps a partial session.
      recordAttempts([
        {
          id: newId('att'),
          questionId: q.id,
          packId: ix.pack.packId,
          sessionId: drill.sessionId,
          mode: 'drill',
          chosen: pick,
          correct: isCorrect(q, pick),
          at: new Date().toISOString(),
          ms: Date.now() - shownAt.current,
        },
      ]);
      setDrill({ ...drill, answers: { ...drill.answers, [q.id]: pick } });
    },
    [drill, q, ix, chosen, recordAttempts, setDrill],
  );

  const finish = useCallback(() => {
    if (drill) endSession(drill.sessionId);
    setDrill(null);
    navigate('/');
  }, [drill, endSession, setDrill]);

  const next = useCallback(() => {
    if (!drill || !chosen) return;
    if (drill.index + 1 >= drill.questionIds.length) finish();
    else setDrill({ ...drill, index: drill.index + 1 });
  }, [drill, chosen, finish, setDrill]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (flag.isOpen || e.ctrlKey || e.metaKey || e.altKey || !q) return;
      const k = e.key.toUpperCase();
      const byNumber = /^[1-9]$/.test(k) ? String.fromCharCode(64 + Number(k)) : null;
      const key = byNumber ?? (/^[A-Z]$/.test(k) && k !== 'F' ? k : null);
      if (!chosen && key && q.options.some((o) => o.key === key)) {
        e.preventDefault();
        answer(key);
      } else if (chosen && e.key === 'Enter') {
        e.preventDefault();
        next();
      } else if (k === 'F') {
        e.preventDefault();
        flag.open();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [q, chosen, answer, next, flag]);

  if (!drill || !ix || !q) {
    return (
      <main className="page narrow">
        <div className="card empty">
          <p>No drill in progress.</p>
          <p style={{ marginTop: 12 }}>
            <a className="btn primary" href="#/drill">
              Set up a drill
            </a>
          </p>
        </div>
      </main>
    );
  }

  const answered = drill.questionIds.filter((id) => drill.answers[id]);
  const correctSoFar = progress.attempts.filter((a) => a.sessionId === drill.sessionId && a.correct).length;
  const total = drill.questionIds.length;
  const right = chosen ? isCorrect(q, chosen) : null;

  return (
    <>
      <header className="run-header">
        <div className="inner">
          <button type="button" className="btn small" onClick={finish}>
            ← End drill
          </button>
          <div className="grow">
            <div className="spread small" style={{ alignItems: 'baseline' }}>
              <span style={{ fontWeight: 600 }} data-testid="drill-position">
                Question {drill.index + 1} of {total} · Drill
              </span>
              <span className="muted">
                {correctSoFar} of {answered.length} correct so far
              </span>
            </div>
            <div className="progress">
              <div style={{ width: `${(100 * answered.length) / total}%` }} />
            </div>
          </div>
        </div>
      </header>
      <main className="page narrow">
        <QuestionMeta q={q} ix={ix} extra={<FlagButton flagged={flag.flagged} onClick={flag.open} />} />
        <Stem q={q} ix={ix} />
        {chosen ? (
          <>
            <p className={`verdict ${right ? 'ok' : 'bad'}`} role="status">
              {right ? '✓ Correct' : '✗ Incorrect'}
            </p>
            <OptionFeedback q={q} chosen={chosen} />
            <KeyIdea q={q} />
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn primary big" onClick={next} autoFocus>
                {drill.index + 1 >= total ? 'Finish drill' : 'Next question →'}
              </button>
            </div>
          </>
        ) : (
          <OptionPicker q={q} selected={null} onPick={answer} />
        )}
        <p className="kbd-hint">Keys: A–D (or 1–4) to answer · Enter for next · F to flag</p>
      </main>
      {flag.dialog}
    </>
  );
}
