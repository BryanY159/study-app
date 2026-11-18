import { useCallback, useEffect, useRef } from 'react';
import { isCorrect } from '../../engine/scoring';
import { newId, useApp } from '../../state/AppProvider';
import { FlagButton, KeyIdea, OptionFeedback, OptionPicker, QuestionMeta, Stem } from '../components/QuestionView';
import { useFlag } from '../components/useFlag';
import { arrowsActive, backToCurrent, chipStates, nextWhileViewing, prev, shownIndex, viewAt, type ChipState } from '../drillNav';
import { navigate } from '../router';
import { useBreakpoint } from '../useBreakpoint';

/**
 * FR-2: one question at a time, feedback right after answering.
 * FR-16: a strip of numbered chips and Previous/Next to look back at earlier
 * questions, read-only (never answered twice), then "Back to current question".
 */
export function DrillRun() {
  const { ix, drill, setDrill, recordAttempts, endSession, progress } = useApp();
  const shownAt = useRef(Date.now());
  const at = drill ? shownIndex(drill) : 0;
  const viewing = drill?.viewing != null;
  const qid = drill?.questionIds[at];
  const q = qid ? ix?.question.get(qid) : undefined;
  const chosen = qid ? drill?.answers[qid] : undefined;
  const flag = useFlag(q, 'drill');
  const phone = useBreakpoint() === 'phone';
  const verdict = useRef<HTMLParagraphElement>(null);
  const strip = useRef<HTMLDivElement>(null);

  // After answering the live question, bring the feedback into view (on a phone it starts below the options).
  const liveChosen = drill ? drill.answers[drill.questionIds[drill.index]] : undefined;
  useEffect(() => {
    if (liveChosen) verdict.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }, [liveChosen]);

  // Keep the chip for the question on screen in view (the strip scrolls sideways on phones).
  useEffect(() => {
    strip.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView?.({ inline: 'center', block: 'nearest' });
  }, [at]);

  useEffect(() => {
    shownAt.current = Date.now();
  }, [drill?.index]);

  const answer = useCallback(
    (key: string) => {
      // Only the live question can be answered, and only once.
      if (!drill || !q || !ix || chosen || drill.viewing != null) return;
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

  /** Next: while viewing, step forward through earlier questions; on the live one, move the drill on. */
  const next = useCallback(() => {
    if (!drill) return;
    if (drill.viewing != null) return setDrill(nextWhileViewing(drill));
    if (!liveChosen) return;
    if (drill.index + 1 >= drill.questionIds.length) finish();
    else setDrill({ ...drill, index: drill.index + 1, viewing: null });
  }, [drill, liveChosen, finish, setDrill]);

  const previous = useCallback(() => drill && setDrill(prev(drill)), [drill, setDrill]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (flag.isOpen || e.ctrlKey || e.metaKey || e.altKey || !q || !drill) return;
      const k = e.key.toUpperCase();
      const byNumber = /^[1-9]$/.test(k) ? String.fromCharCode(64 + Number(k)) : null;
      const key = byNumber ?? (/^[A-Z]$/.test(k) && k !== 'F' ? k : null);
      if (!viewing && !chosen && key && q.options.some((o) => o.key === key)) {
        e.preventDefault();
        answer(key);
      } else if ((chosen || viewing) && e.key === 'Enter') {
        e.preventDefault();
        next();
      } else if (arrowsActive(drill) && e.key === 'ArrowLeft') {
        e.preventDefault();
        previous();
      } else if (arrowsActive(drill) && e.key === 'ArrowRight') {
        e.preventDefault();
        next();
      } else if (k === 'F') {
        e.preventDefault();
        flag.open();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [q, drill, chosen, viewing, answer, next, previous, flag]);

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
  const states = chipStates(drill, (id, c) => {
    const question = ix.question.get(id);
    return !!question && isCorrect(question, c);
  });
  const nextLabel = viewing ? 'Next →' : drill.index + 1 >= total ? 'Finish drill' : 'Next question →';
  const canPrev = at > 0;

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
        <QuestionStrip states={states} at={at} live={drill.index} onOpen={(i) => setDrill(viewAt(drill, i))} stripRef={strip} />
      </header>
      <main className={phone ? 'page narrow with-bottom-bar' : 'page narrow'}>
        {viewing && (
          <div className="banner reviewing row" data-testid="reviewing">
            <span className="grow">
              Looking back at question {at + 1}. Your answer stays as it was.
            </span>
            <button type="button" className="btn small primary" onClick={() => setDrill(backToCurrent(drill))}>
              Back to current question
            </button>
          </div>
        )}
        <QuestionMeta q={q} ix={ix} extra={phone ? undefined : <FlagButton flagged={flag.flagged} onClick={flag.open} />} />
        <Stem q={q} ix={ix} />
        {chosen ? (
          <>
            <p ref={viewing ? undefined : verdict} className={`verdict ${right ? 'ok' : 'bad'}`} role="status">
              {right ? '✓ Correct' : '✗ Incorrect'}
            </p>
            <OptionFeedback q={q} chosen={chosen} />
            <KeyIdea q={q} />
          </>
        ) : (
          <OptionPicker q={q} selected={null} onPick={answer} />
        )}
        {!phone && (
          <div className="row">
            <button type="button" className="btn" onClick={previous} disabled={!canPrev}>
              ← Previous
            </button>
            <span className="grow" />
            {(chosen || viewing) && (
              <button type="button" className="btn primary big" onClick={next} autoFocus={!viewing}>
                {nextLabel}
              </button>
            )}
          </div>
        )}
        <p className="kbd-hint">Keys: A–D (or 1–4) to answer · Enter for next · ←/→ to move after answering · F to flag</p>
      </main>
      {phone && (
        // Phone: Flag, Previous and Next stay reachable at the bottom of the screen.
        <div className="bottom-bar" data-testid="bottom-bar">
          <FlagButton flagged={flag.flagged} onClick={flag.open} />
          <button type="button" className="btn" onClick={previous} disabled={!canPrev} aria-label="Previous question">
            ←
          </button>
          {(chosen || viewing) && (
            <button type="button" className="btn primary grow" onClick={next}>
              {nextLabel}
            </button>
          )}
        </div>
      )}
      {flag.dialog}
    </>
  );
}

const CHIP_LABEL: Record<ChipState, string> = { correct: 'correct', incorrect: 'incorrect', current: 'on screen', 'not-yet': 'not answered yet' };

/** One numbered chip per question, colored by result. Answered ones open read-only; later ones are disabled. */
function QuestionStrip({
  states,
  at,
  live,
  onOpen,
  stripRef,
}: {
  states: ChipState[];
  at: number;
  live: number;
  onOpen: (i: number) => void;
  stripRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <nav className="qstrip" aria-label="Questions in this drill" ref={stripRef} data-testid="question-strip">
      {states.map((s, i) => (
        <button
          key={i}
          type="button"
          className={`qchip ${s}${i === live ? ' live' : ''}`}
          aria-current={i === at ? 'true' : undefined}
          aria-label={`Question ${i + 1}, ${CHIP_LABEL[s]}`}
          disabled={i > live}
          onClick={() => onOpen(i)}
        >
          {i + 1}
        </button>
      ))}
    </nav>
  );
}
