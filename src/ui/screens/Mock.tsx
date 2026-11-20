import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { assembleMock } from '../../engine/mock';
import { mulberry32, randomSeed } from '../../engine/rng';
import { isCorrect } from '../../engine/scoring';
import { scoreSections } from '../../engine/sections';
import type { PackIndex } from '../../engine/packIndex';
import type { ActiveMock, Attempt, ProgressDoc } from '../../storage/docs';
import { useApp } from '../../state/AppProvider';
import { FlagButton, OptionPicker, QuestionMeta, Stem } from '../components/QuestionView';
import { useFlag } from '../components/useFlag';
import { navigate } from '../router';
import { useBreakpoint } from '../useBreakpoint';
import { Welcome } from './Welcome';

export function remainingMs(m: ActiveMock, now = Date.now()): number | null {
  if (m.timeLimitMinutes === null) return null;
  return Math.max(0, new Date(m.startedAt).getTime() + m.timeLimitMinutes * 60_000 - now);
}

export const formatClock = (ms: number): string => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Score a mock: every question gets an attempt; blanks count as wrong (FR-3).
 * Returns the progress doc with the attempts added, the session closed and the active mock cleared.
 */
export function submitMock(p: ProgressDoc, ix: PackIndex, now = new Date()): ProgressDoc {
  const m = p.activeMock;
  if (!m) return p;
  const elapsed = now.getTime() - new Date(m.startedAt).getTime();
  const each = Math.round(elapsed / Math.max(m.questionIds.length, 1));
  const attempts: Attempt[] = m.questionIds.flatMap((id) => {
    const q = ix.question.get(id);
    if (!q) return [];
    const a = m.answers[id];
    const chosen = a ? [a] : [];
    return [{ id: `${m.sessionId}|${id}`, questionId: id, packId: m.packId, sessionId: m.sessionId, mode: 'mock' as const, chosen, correct: isCorrect(q, chosen), at: now.toISOString(), ms: each }];
  });
  // Packs with exam sections also keep each section's score with the session (history, comparing mocks).
  const sections = ix.pack.examBlueprint.sections;
  const sectionScores = sections ? scoreSections(ix, sections, attempts.map((a) => ({ questionId: a.questionId, correct: a.correct }))) : undefined;
  return {
    ...p,
    attempts: [...p.attempts, ...attempts],
    sessions: p.sessions.map((s) => (s.id === m.sessionId ? { ...s, endedAt: now.toISOString(), marked: m.marked, ...(sectionScores ? { sectionScores } : {}) } : s)),
    activeMock: null,
  };
}

/**
 * I-5: drop questions the active pack no longer has (retired in an update), keeping her
 * answers to the rest. Returns the same object when nothing is missing, null when nothing is left.
 */
export function repairActiveMock(m: ActiveMock, ix: PackIndex): ActiveMock | null {
  const keep = m.questionIds.filter((id) => ix.question.has(id));
  if (keep.length === m.questionIds.length) return m;
  if (!keep.length) return null;
  const currentId = m.questionIds.slice(m.current).find((id) => ix.question.has(id)) ?? keep[keep.length - 1];
  return {
    ...m,
    questionIds: keep,
    answers: Object.fromEntries(Object.entries(m.answers).filter(([id]) => ix.question.has(id))),
    marked: m.marked.filter((id) => ix.question.has(id)),
    current: keep.indexOf(currentId),
  };
}

/** End an unfinished exam without scoring it. */
export const discardMock = (p: ProgressDoc, now = new Date()): ProgressDoc =>
  p.activeMock
    ? { ...p, sessions: p.sessions.map((s) => (s.id === p.activeMock!.sessionId ? { ...s, endedAt: now.toISOString() } : s)), activeMock: null }
    : p;

export function MockStart() {
  const { ix, progress, flags, startSession, updateProgress } = useApp();
  const [timed, setTimed] = useState(true);
  if (!ix) return <Welcome />;
  const bp = ix.pack.examBlueprint;
  const active = progress.activeMock;

  const start = () => {
    const exclude = new Set(progress.settings.hideFlagged ? flags.flags.map((f) => f.questionId) : []);
    const { questions, warnings } = assembleMock(ix, bp, mulberry32(randomSeed()), exclude);
    if (!questions.length) return;
    const questionIds = questions.map((q) => q.id);
    const timeLimitMinutes = timed ? bp.timeLimitMinutes : null;
    const sessionId = startSession({ mode: 'mock', packId: ix.pack.packId, label: 'Mock exam', questionIds, timeLimitMinutes });
    updateProgress((p) => ({
      ...p,
      activeMock: { sessionId, packId: ix.pack.packId, questionIds, answers: {}, marked: [], startedAt: new Date().toISOString(), timeLimitMinutes, current: 0, warnings },
    }));
    navigate('/mock/run');
  };

  return (
    <main className="page narrow">
      <h1>Mock exam</h1>
      {active ? (
        <section className="card stack">
          <h2>You have an exam in progress</h2>
          <p className="muted">
            {Object.values(active.answers).filter(Boolean).length} of {active.questionIds.length} answered
            {active.timeLimitMinutes !== null && ` · ${formatClock(remainingMs(active) ?? 0)} left`}
          </p>
          <div className="row">
            <a className="btn primary big" href="#/mock/run">
              Resume exam
            </a>
            <button
              type="button"
              className="btn danger"
              onClick={() => {
                if (window.confirm('Discard this exam? Your answers in it will not be scored.')) updateProgress((p) => discardMock(p));
              }}
            >
              Discard this exam
            </button>
          </div>
        </section>
      ) : (
        <section className="card stack-lg">
          <p>
            {bp.questionCount} multiple-choice questions drawn from all modules (each module gets at least {Math.round(bp.minModuleShare * 100)}%). No
            feedback until you submit. You can move between questions and mark them for review.
          </p>
          <label className="check">
            <input type="checkbox" checked={timed} onChange={(e) => setTimed(e.target.checked)} />
            {bp.timeLimitMinutes}-minute timer (unanswered questions count as wrong when time runs out)
          </label>
          <div className="row">
            <button type="button" className="btn primary big" onClick={start}>
              Start mock exam
            </button>
          </div>
        </section>
      )}
    </main>
  );
}

export function MockRun() {
  const { ix, progress, updateProgress, packs, setActivePack } = useApp();
  const saved = progress.activeMock;
  const samePack = !saved || !ix || saved.packId === ix.pack.packId;
  const repaired = saved && ix && samePack ? repairActiveMock(saved, ix) : saved;
  const m = samePack ? repaired : null;
  const [now, setNow] = useState(Date.now());
  const [confirming, setConfirming] = useState(false);
  const [gridOpen, setGridOpen] = useState(false);
  const phone = useBreakpoint() === 'phone';
  const qid = m?.questionIds[m.current];
  const q = qid ? ix?.question.get(qid) : undefined;
  const lastKey = q?.options.at(-1)?.key ?? 'D';
  const flag = useFlag(q, 'mock');

  const patch = useCallback(
    (fn: (m: ActiveMock) => ActiveMock) => updateProgress((p) => (p.activeMock ? { ...p, activeMock: fn(p.activeMock) } : p)),
    [updateProgress],
  );
  const submit = useCallback(() => {
    if (!ix || !m) return;
    const id = m.sessionId;
    updateProgress((p) => submitMock(p, ix));
    navigate(`/mock/results/${id}`);
  }, [ix, m, updateProgress]);

  // Save the repair (a retired question dropped), or close the exam if none of its questions are left.
  useEffect(() => {
    if (!saved || repaired === saved || !samePack) return;
    updateProgress((p) => (repaired ? { ...p, activeMock: repaired } : discardMock(p)));
  }, [saved, repaired, samePack, updateProgress]);

  const left = m ? remainingMs(m, now) : null;
  useEffect(() => {
    if (!m || m.timeLimitMinutes === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [m]);
  useEffect(() => {
    if (left === 0) submit();
  }, [left, submit]);

  const go = useCallback((i: number) => m && patch((x) => ({ ...x, current: Math.max(0, Math.min(x.questionIds.length - 1, i)) })), [m, patch]);
  const pick = useCallback((key: string) => qid && patch((x) => ({ ...x, answers: { ...x.answers, [qid]: key } })), [qid, patch]);
  const toggleMark = useCallback(
    () => qid && patch((x) => ({ ...x, marked: x.marked.includes(qid) ? x.marked.filter((id) => id !== qid) : [...x.marked, qid] })),
    [qid, patch],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (flag.isOpen || gridOpen || !m || !q || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toUpperCase();
      const byNumber = /^[1-9]$/.test(k) ? String.fromCharCode(64 + Number(k)) : null;
      const key = byNumber ?? (/^[A-E]$/.test(k) ? k : null);
      if (key && q.options.some((o) => o.key === key)) pick(key);
      else if (e.key === 'ArrowRight' || e.key === 'Enter') go(m.current + 1);
      else if (e.key === 'ArrowLeft') go(m.current - 1);
      else if (k === 'M') toggleMark();
      else if (k === 'F') flag.open();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [m, q, pick, go, toggleMark, flag, gridOpen]);

  if (!ix) return <Welcome />;
  if (saved && !samePack) {
    const other = packs.find((p) => p.packId === saved.packId);
    return (
      <main className="page narrow">
        <div className="card stack" data-testid="mock-other-pack">
          <p>This exam in progress uses another question pack{other ? ` (${other.title})` : ''}.</p>
          <div className="row">
            {other && (
              <button type="button" className="btn primary" onClick={() => setActivePack(other.packId)}>
                Switch to that pack
              </button>
            )}
            <button type="button" className="btn danger" onClick={() => updateProgress((p) => discardMock(p))}>
              Discard this exam
            </button>
          </div>
        </div>
      </main>
    );
  }
  if (!m || !q) {
    return (
      <main className="page narrow">
        <div className="card empty">
          <p>No mock exam in progress.</p>
          <p style={{ marginTop: 12 }}>
            <a className="btn primary" href="#/mock">
              Start a mock exam
            </a>
          </p>
        </div>
      </main>
    );
  }

  const answeredCount = m.questionIds.filter((id) => m.answers[id]).length;
  const unanswered = m.questionIds.length - answeredCount;
  const marked = m.marked.includes(q.id);
  const position = (
    <span className="small muted" data-testid="mock-position">
      Question {m.current + 1} of {m.questionIds.length}
    </span>
  );
  const timer = left !== null && (
    <div className={`timer${left < 5 * 60_000 ? ' low' : ''}`} role="timer" aria-label="Time remaining" data-testid="timer">
      {formatClock(left)}
    </div>
  );
  const grid = (
    <QuestionGrid
      m={m}
      unanswered={unanswered}
      confirming={confirming}
      onGo={(i) => {
        go(i);
        setGridOpen(false);
      }}
      onConfirm={setConfirming}
      onSubmit={submit}
    />
  );

  if (phone) {
    return (
      <>
        <header className="run-header">
          <div className="inner">
            <div className="grow" style={{ fontWeight: 700 }}>
              {position}
            </div>
            {timer}
            <button type="button" className="btn small" aria-haspopup="dialog" aria-expanded={gridOpen} onClick={() => setGridOpen(true)}>
              All questions
            </button>
          </div>
        </header>
        <main className="page narrow with-bottom-bar">
          {m.warnings.map((w) => (
            <div key={w} className="banner warn">
              {w}
            </div>
          ))}
          <QuestionMeta q={q} ix={ix} extra={<FlagButton flagged={flag.flagged} onClick={flag.open} />} />
          <Stem q={q} ix={ix} />
          <OptionPicker q={q} selected={m.answers[q.id] ?? null} onPick={pick} />
          <p className="small muted">No feedback until you submit. Unanswered questions count as wrong.</p>
        </main>
        <div className="bottom-bar" data-testid="bottom-bar">
          <button type="button" className="btn" onClick={() => go(m.current - 1)} disabled={m.current === 0} aria-label="Previous question">
            ← Prev
          </button>
          <button type="button" className={marked ? 'btn seg grow' : 'btn grow'} aria-pressed={marked} onClick={toggleMark}>
            {marked ? 'Marked' : 'Mark'}
          </button>
          <button type="button" className="btn primary" onClick={() => go(m.current + 1)} disabled={m.current === m.questionIds.length - 1} aria-label="Next question">
            Next →
          </button>
        </div>
        {gridOpen && (
          <GridSheet onClose={() => setGridOpen(false)} summary={`${answeredCount} answered · ${m.marked.length} marked`} current={m.current + 1}>
            {grid}
          </GridSheet>
        )}
        {flag.dialog}
      </>
    );
  }

  return (
    <>
      <header className="run-header wide">
        <div className="inner">
          <div style={{ fontWeight: 700 }}>Mock exam · {m.questionIds.length} questions</div>
          <div className="grow muted small">
            {answeredCount} answered · {m.marked.length} marked
          </div>
          {timer}
        </div>
      </header>
      <main className="page">
        {m.warnings.map((w) => (
          <div key={w} className="banner warn">
            {w}
          </div>
        ))}
        <div className="grid-aside mock-layout">
          <section className="card stack-lg">
            <QuestionMeta
              q={q}
              ix={ix}
              extra={
                <>
                  {position}
                  <FlagButton flagged={flag.flagged} onClick={flag.open} />
                </>
              }
            />
            <Stem q={q} ix={ix} />
            <OptionPicker q={q} selected={m.answers[q.id] ?? null} onPick={pick} />
            <div className="row">
              <button type="button" className="btn" onClick={() => go(m.current - 1)} disabled={m.current === 0}>
                ← Previous
              </button>
              <label className="check">
                <input type="checkbox" checked={marked} onChange={toggleMark} /> Mark for review
              </label>
              <span className="grow" />
              <button type="button" className="btn primary" onClick={() => go(m.current + 1)} disabled={m.current === m.questionIds.length - 1}>
                Next →
              </button>
            </div>
            <p className="small muted">
              No feedback until you submit. Unanswered questions count as wrong.<span className="kbd-only"> Keys: A–{lastKey} answer · ←/→ move · M mark · F flag</span>
            </p>
          </section>
          <aside className="card stack mock-grid-col">{grid}</aside>
        </div>
      </main>
      {flag.dialog}
    </>
  );
}

/** The question grid with its legend and Submit: in the side column, or inside the phone sheet. */
function QuestionGrid({
  m,
  unanswered,
  confirming,
  onGo,
  onConfirm,
  onSubmit,
}: {
  m: ActiveMock;
  unanswered: number;
  confirming: boolean;
  onGo: (i: number) => void;
  onConfirm: (v: boolean) => void;
  onSubmit: () => void;
}) {
  return (
    <>
      <div className="grid-title" style={{ fontWeight: 600 }}>
        Questions
      </div>
      <div className="navgrid" data-testid="navgrid">
        {m.questionIds.map((id, i) => {
          const cls = ['navcell', m.answers[id] ? 'answered' : '', m.marked.includes(id) ? 'marked' : '', i === m.current ? 'current' : ''].join(' ');
          return (
            <button
              key={id}
              type="button"
              className={cls}
              onClick={() => onGo(i)}
              aria-current={i === m.current ? 'true' : undefined}
              aria-label={`Question ${i + 1}${m.answers[id] ? ', answered' : ''}${m.marked.includes(id) ? ', marked' : ''}`}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
      <div className="legend">
        <span>
          <i className="legend-answered" />
          Answered
        </span>
        <span>
          <i className="legend-marked" />
          Marked
        </span>
        <span>
          <i />
          Not answered
        </span>
      </div>
      {confirming ? (
        <div className="stack" style={{ gap: 8 }}>
          <p className="small">{unanswered ? `${unanswered} question${unanswered === 1 ? ' is' : 's are'} unanswered and will count as wrong.` : 'Submit your answers?'}</p>
          <button type="button" className="btn primary" onClick={onSubmit}>
            Yes, submit
          </button>
          <button type="button" className="btn" onClick={() => onConfirm(false)}>
            Keep working
          </button>
        </div>
      ) : (
        <button type="button" className="btn primary big" onClick={() => onConfirm(true)}>
          Submit exam
        </button>
      )}
    </>
  );
}

/** Phone: the question grid in a panel that slides up. Traps focus; Esc or a backdrop tap closes it. */
function GridSheet({ children, onClose, summary, current }: { children: ReactNode; onClose: () => void; summary: string; current: number }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = panel.current;
    el?.querySelector<HTMLElement>('[aria-current="true"]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'Tab' && el) {
        const items = [...el.querySelectorAll<HTMLElement>('button:not([disabled])')];
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose} data-testid="grid-sheet">
      <div ref={panel} className="sheet slide-up stack" role="dialog" aria-modal="true" aria-label="All questions" onClick={(e) => e.stopPropagation()}>
        <div className="grabber" aria-hidden="true" />
        <div className="spread">
          <strong>All questions</strong>
          <span className="small muted">{summary}</span>
        </div>
        {children}
        <button type="button" className="btn" onClick={onClose}>
          Back to question {current}
        </button>
      </div>
    </div>
  );
}
