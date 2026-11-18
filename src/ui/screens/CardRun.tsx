import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addDays, INTERVAL_DAYS, localDay, nextBox, requeueAgain, type Rating } from '../../engine/leitner';
import { cardsOf, type Flashcard } from '../../pack/schema';
import { cardKey } from '../../storage/docs';
import { editableFlag } from '../../engine/flags';
import { useApp, type CardRun as CardRunState, type CardUndo } from '../../state/AppProvider';
import { CardFace } from '../components/CardFace';
import { FlagDialog } from '../components/FlagDialog';
import { navigate } from '../router';
import { swipeRating } from '../swipe';
import { useBreakpoint } from '../useBreakpoint';

const whenText = (days: number) => (days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`);

/**
 * FR-12: one card at a time. Tap / Space / Enter flips it; then Again or Got it
 * (buttons, keys 1/2 or ←/→, or a swipe). Again brings the card back later in this
 * session. Undo reverses the last rating until the next card is rated.
 */
export function CardRun() {
  const { ix, cardRun: run, setCardRun, cards, rateCard, undoRating, flags, packs, addFlag, updateFlag } = useApp();
  const phone = useBreakpoint() === 'phone';
  const laptop = useBreakpoint() === 'laptop';
  const deck = useMemo(() => new Map((ix ? cardsOf(ix.pack) : []).map((c) => [c.id, c])), [ix]);
  const [last, setLast] = useState<{ undo: CardUndo; before: CardRunState } | null>(null);
  const [flagOpen, setFlagOpen] = useState(false);
  // The drag start lives in a ref: pointer events can arrive faster than React re-renders.
  const dragStart = useRef<{ x0: number; y0: number } | null>(null);
  const [dragDx, setDragDx] = useState(0);
  const cardEl = useRef<HTMLDivElement>(null);

  const card: Flashcard | undefined = run && run.pos < run.queue.length ? deck.get(run.queue[run.pos]) : undefined;
  const done = !!run && run.pos >= run.queue.length;
  const cram = run?.mode === 'cram';
  const existingFlag = card && ix ? editableFlag(flags.flags, packs, ix.pack.packId, card.id, 'card') : undefined;

  const flip = useCallback(() => run && !run.flipped && setCardRun({ ...run, flipped: true }), [run, setCardRun]);

  const rate = useCallback(
    (rating: Rating) => {
      if (!run || !card || !ix || !run.flipped) return;
      const undo = rateCard({ packId: ix.pack.packId, cardId: card.id, rating, cram: run.mode === 'cram', examDate: ix.pack.examDate });
      const firstTry = !run.rated.some((r) => r.cardId === card.id);
      const queue = rating === 'again' ? requeueAgain(run.queue, run.pos) : run.queue;
      setLast({ undo, before: run });
      setCardRun({ ...run, queue, pos: run.pos + 1, flipped: false, rated: [...run.rated, { cardId: card.id, rating, firstTry }] });
    },
    [run, card, ix, rateCard, setCardRun],
  );

  const undo = useCallback(() => {
    if (!last) return;
    undoRating(last.undo);
    setCardRun({ ...last.before, flipped: true });
    setLast(null);
  }, [last, undoRating, setCardRun]);

  const end = useCallback(() => {
    setCardRun(run ? { ...run, queue: run.queue.slice(0, run.pos), flipped: false } : null);
  }, [run, setCardRun]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (flagOpen || !card || e.ctrlKey || e.metaKey || e.altKey) return;
      if (!run?.flipped && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        flip();
      } else if (run?.flipped && (e.key === '1' || e.key === 'ArrowLeft')) {
        e.preventDefault();
        rate('again');
      } else if (run?.flipped && (e.key === '2' || e.key === 'ArrowRight')) {
        e.preventDefault();
        rate('got-it');
      } else if (e.key.toLowerCase() === 'z' && last) {
        e.preventDefault();
        undo();
      } else if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setFlagOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card, run?.flipped, flagOpen, flip, rate, undo, last]);

  if (!ix || !run) {
    return (
      <main className="page narrow">
        <div className="card empty">
          <p>No card session in progress.</p>
          <p style={{ marginTop: 12 }}>
            <a className="btn primary" href="#/cards">
              Set up flashcards
            </a>
          </p>
        </div>
      </main>
    );
  }
  if (done || !card) return <CardSummary run={run} />;

  const topicName = ix.topic.get(card.topicIds[0])?.name ?? '';
  const key = cardKey(ix.pack.packId, card.id);
  const state = cards.states[key];
  const current = state && !state.fresh ? state.box : undefined;
  const hint = (rating: Rating) => {
    if (cram) return 'practice only';
    const box = nextBox(current, rating);
    return `box ${box} · ${whenText(INTERVAL_DAYS[box - 1])}`;
  };
  const gotItCount = run.rated.filter((r) => r.rating === 'got-it').length;
  const againCount = run.rated.filter((r) => r.rating === 'again').length;
  const dx = dragDx;

  const pointer = {
    onPointerDown: (e: React.PointerEvent) => {
      dragStart.current = { x0: e.clientX, y0: e.clientY };
      setDragDx(0);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (dragStart.current && run.flipped) setDragDx(e.clientX - dragStart.current.x0);
    },
    onPointerUp: (e: React.PointerEvent) => {
      const start = dragStart.current;
      dragStart.current = null;
      setDragDx(0);
      if (!start) return;
      const ddx = e.clientX - start.x0;
      const ddy = e.clientY - start.y0;
      const r = swipeRating(ddx, ddy, run.flipped);
      if (r) rate(r);
      else if (!run.flipped && Math.abs(ddx) < 10 && Math.abs(ddy) < 10) flip();
    },
    onPointerCancel: () => {
      dragStart.current = null;
      setDragDx(0);
    },
  };

  return (
    <>
      <header className="run-header">
        <div className="inner">
          <button type="button" className="btn small" onClick={end}>
            End session
          </button>
          <div className="grow small" style={{ fontWeight: 600 }} data-testid="card-position">
            Card {run.pos + 1} of {run.queue.length}
            {cram && <span className="muted"> · practice</span>}
          </div>
          <button type="button" className="btn small" onClick={() => setFlagOpen(true)} aria-label="Flag this card">
            {existingFlag ? 'Flagged' : 'Flag'}
          </button>
        </div>
      </header>
      <main className={phone ? 'page narrow with-bottom-bar card-page' : 'page narrow card-page'}>
        <div className={laptop ? 'card-layout' : ''}>
          <div
            ref={cardEl}
            className={`flashcard${run.flipped ? ' flipped' : ''}`}
            role="button"
            tabIndex={0}
            aria-label={run.flipped ? 'Card answer' : 'Card front. Tap, Space or Enter to show the answer'}
            data-testid="flashcard"
            style={dx ? { transform: `translateX(${dx}px) rotate(${dx / 30}deg)` } : undefined}
            {...pointer}
          >
            <CardFace card={card} topicName={topicName} flipped={run.flipped} />
            {!run.flipped && <p className="small muted card-hint">{phone ? 'Tap the card to see the answer' : 'Tap the card, or press Space, to see the answer'}</p>}
          </div>
          {laptop && (
            <aside className="card stack card-side">
              <div style={{ fontWeight: 600 }}>This session</div>
              <div className="list-row">
                <span>Got it</span>
                <span>{gotItCount}</span>
              </div>
              <div className="list-row">
                <span>Again (coming back)</span>
                <span>{againCount}</span>
              </div>
              <div className="list-row">
                <span>Left</span>
                <span>{run.queue.length - run.pos}</span>
              </div>
              <p className="small muted kbd-only">Space flips · 1 Again · 2 Got it · Z undo · F flag</p>
            </aside>
          )}
        </div>
        {/* Announces the answer when the card flips (screen readers). */}
        <p className="sr-only" aria-live="polite" data-testid="card-live">
          {run.flipped ? `Answer: ${card.back}` : ''}
        </p>
        {!phone && <RatingButtons flipped={run.flipped} onFlip={flip} onRate={rate} hint={hint} />}
        {last && (
          <div className="row">
            <button type="button" className="btn small" onClick={undo} data-testid="undo">
              ↶ Undo last rating
            </button>
          </div>
        )}
        {phone && run.flipped && <p className="small muted" style={{ textAlign: 'center' }}>Or swipe: ← Again · Got it →</p>}
      </main>
      {phone && (
        <div className="bottom-bar" data-testid="bottom-bar">
          <RatingButtons flipped={run.flipped} onFlip={flip} onRate={rate} hint={hint} />
        </div>
      )}
      {flagOpen && (
        <FlagDialog
          item={{ kind: 'card', id: card.id, text: card.front }}
          initial={existingFlag ? { reason: existingFlag.reason, comment: existingFlag.comment } : undefined}
          onClose={() => setFlagOpen(false)}
          onSave={(reason, comment) => {
            if (existingFlag) updateFlag(existingFlag.id, { reason, comment });
            else addFlag({ itemType: 'card', questionId: card.id, reason, comment, mode: 'review', source: 'user' });
            setFlagOpen(false);
          }}
        />
      )}
    </>
  );
}

function RatingButtons({ flipped, onFlip, onRate, hint }: { flipped: boolean; onFlip: () => void; onRate: (r: Rating) => void; hint: (r: Rating) => string }) {
  if (!flipped) {
    return (
      <button type="button" className="btn primary big grow" onClick={onFlip}>
        Show answer
      </button>
    );
  }
  return (
    <div className="row rating-row" style={{ gap: 10, width: '100%' }}>
      <button type="button" className="btn big grow rate-again" onClick={() => onRate('again')}>
        <span className="stack" style={{ gap: 0, alignItems: 'center' }}>
          <span>Again</span>
          <span className="small muted">{hint('again')}</span>
        </span>
      </button>
      <button type="button" className="btn primary big grow" onClick={() => onRate('got-it')}>
        <span className="stack" style={{ gap: 0, alignItems: 'center' }}>
          <span>Got it</span>
          <span className="small">{hint('got-it')}</span>
        </span>
      </button>
    </div>
  );
}

/** End of a session: counts, the box spread, the next due day, and what to do next. */
function CardSummary({ run }: { run: CardRunState }) {
  const { ix, cards, setCardRun, now } = useApp();
  if (!ix) return null;
  const packId = ix.pack.packId;
  const reviewed = new Set(run.rated.map((r) => r.cardId));
  const firstTries = run.rated.filter((r) => r.firstTry);
  const firstTryOk = firstTries.filter((r) => r.rating === 'got-it').length;
  const pct = firstTries.length ? Math.round((100 * firstTryOk) / firstTries.length) : 0;
  const boxes = [1, 2, 3, 4, 5].map((b) => [...reviewed].filter((id) => cards.states[cardKey(packId, id)]?.box === b && !cards.states[cardKey(packId, id)]?.fresh).length);
  const stillLearning = [...reviewed].filter((id) => (cards.states[cardKey(packId, id)]?.box ?? 1) === 1);
  const today = localDay(now());
  const upcoming = cardsOf(ix.pack)
    .map((c) => cards.states[cardKey(packId, c.id)])
    .filter((s): s is NonNullable<typeof s> => !!s && !s.fresh && s.dueDate > today)
    .map((s) => s.dueDate)
    .sort();
  const nextDay = upcoming[0];
  const nextCount = upcoming.filter((d) => d === nextDay).length;
  const deck = new Map(cardsOf(ix.pack).map((c) => [c.id, c]));
  const topics = [...new Set(stillLearning.flatMap((id) => deck.get(id)?.topicIds ?? []))];
  const drillTopics = topics.length ? topics : run.topicIds;

  return (
    <main className="page narrow" data-testid="card-summary">
      <h1>Session complete</h1>
      <div className="grid-3">
        <div className="card stack" style={{ gap: 2 }}>
          <span className="big-score" data-testid="summary-reviewed">
            {reviewed.size}
          </span>
          <span className="muted">cards reviewed</span>
        </div>
        <div className="card stack" style={{ gap: 2 }}>
          <span className="big-score" data-testid="summary-first-try">
            {pct}%
          </span>
          <span className="muted">Got it on the first try</span>
        </div>
        <div className="card stack" style={{ gap: 2 }}>
          <span className="big-score" data-testid="summary-box1">
            {stillLearning.length}
          </span>
          <span className="muted">still in box 1</span>
        </div>
      </div>
      {run.mode !== 'cram' && (
        <section className="card stack">
          <h2>Where these cards are now</h2>
          <div className="box-spread" data-testid="box-spread">
            {boxes.map((n, i) => (
              <div key={i} className="box-col">
                <div className="box-bar" style={{ height: `${Math.max(4, n * 12)}px` }} />
                <strong>{n}</strong>
                <span className="small muted">
                  Box {i + 1} · {i === 0 ? 'today' : `${INTERVAL_DAYS[i]} day${INTERVAL_DAYS[i] === 1 ? '' : 's'}`}
                </span>
              </div>
            ))}
          </div>
          <p data-testid="summary-next">
            {nextDay ? `Next due: ${nextCount} card${nextCount === 1 ? '' : 's'} ${nextDay === addDays(today, 1) ? 'tomorrow' : `on ${new Date(nextDay + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}` : 'Nothing else is scheduled yet.'}
          </p>
        </section>
      )}
      {run.mode === 'cram' && <p className="muted">Practice session: the schedule was not changed.</p>}
      <div className="row">
        <a
          className="btn primary"
          href={`#/drill?topics=${drillTopics.join(',')}`}
          onClick={() => setCardRun(null)}
        >
          Drill {drillTopics.length === 1 ? 'this topic' : `these ${drillTopics.length} topics`}
        </a>
        {stillLearning.length > 0 && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              setCardRun({ ...run, mode: 'cram', queue: stillLearning, pos: 0, flipped: false, rated: [], undo: null, startedAt: now().toISOString() });
            }}
          >
            Review {stillLearning.length} again
          </button>
        )}
        <button
          type="button"
          className="btn"
          onClick={() => {
            setCardRun(null);
            navigate('/');
          }}
        >
          Done
        </button>
      </div>
    </main>
  );
}
