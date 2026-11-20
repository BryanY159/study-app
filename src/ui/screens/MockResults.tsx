import { useState } from 'react';
import type { Question } from '../../pack/schema';
import { pct } from '../../engine/scoring';
import { scoreSections, sectionTopicIds, weakestSectionIndex } from '../../engine/sections';
import { useApp } from '../../state/AppProvider';
import { KeyIdea, OptionFeedback, QuestionMeta, Stem } from '../components/QuestionView';
import { useFlag } from '../components/useFlag';
import { barClass } from './Dashboard';
import { formatClock } from './Mock';
import { Welcome } from './Welcome';

type Tab = 'all' | 'incorrect' | 'marked' | 'flagged';

export function MockResults({ sessionId }: { sessionId: string }) {
  const { ix, progress, flags } = useApp();
  const [tab, setTab] = useState<Tab>('incorrect');
  if (!ix) return <Welcome />;
  const session = progress.sessions.find((s) => s.id === sessionId);
  if (!session) {
    return (
      <main className="page narrow">
        <div className="card empty">That mock exam was not found.</div>
      </main>
    );
  }
  const attempts = new Map(progress.attempts.filter((a) => a.sessionId === sessionId).map((a) => [a.questionId, a]));
  const rows = session.questionIds.map((id, i) => ({ n: i + 1, q: ix.question.get(id), a: attempts.get(id) })).filter((r): r is typeof r & { q: Question } => !!r.q);
  const correct = rows.filter((r) => r.a?.correct).length;
  const total = rows.length;
  const flaggedIds = new Set(flags.flags.map((f) => f.questionId));

  // Packs with exam sections: a score per section (saved with the session; older sessions are scored from the pack).
  const packSections = ix.pack.examBlueprint.sections;
  const sectionScores = packSections
    ? (session.sectionScores ?? scoreSections(ix, packSections, rows.map((r) => ({ questionId: r.q.id, correct: !!r.a?.correct }))))
    : null;
  const weakestSection = sectionScores ? weakestSectionIndex(sectionScores) : -1;

  const byModule = ix.pack.modules
    .map((m) => {
      const mine = rows.filter((r) => ix.moduleOf(r.q) === m.id);
      return { id: m.id, name: m.name, correct: mine.filter((r) => r.a?.correct).length, total: mine.length };
    })
    .filter((m) => m.total > 0);
  const missedByTopic = new Map<string, { wrong: number; total: number }>();
  for (const r of rows) {
    const t = r.q.topicIds[0];
    const s = missedByTopic.get(t) ?? { wrong: 0, total: 0 };
    s.total++;
    if (!r.a?.correct) s.wrong++;
    missedByTopic.set(t, s);
  }
  const mostMissed = [...missedByTopic.entries()].filter(([, s]) => s.wrong > 0).sort((a, b) => b[1].wrong - a[1].wrong || a[1].total - b[1].total).slice(0, 3);
  const used = session.endedAt ? new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime() : 0;

  const filtered = rows.filter((r) =>
    tab === 'all' ? true : tab === 'incorrect' ? !r.a?.correct : tab === 'marked' ? session.marked.includes(r.q.id) : flaggedIds.has(r.q.id),
  );
  const tabCounts: Record<Tab, number> = {
    all: total,
    incorrect: total - correct,
    marked: rows.filter((r) => session.marked.includes(r.q.id)).length,
    flagged: rows.filter((r) => flaggedIds.has(r.q.id)).length,
  };

  return (
    <main className="page">
      <div className="grid-main">
        <section className="card stack">
          <div className="eyebrow">
            Mock exam · {new Date(session.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {formatClock(used)} used
            {session.timeLimitMinutes !== null ? ` of ${session.timeLimitMinutes}:00` : ' (untimed)'}
          </div>
          <div className="big-score" data-testid="mock-score">
            {correct}
            <span> / {total}</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 600 }}>{pct({ correct, total })}%</div>
          {sectionScores && (
            <div className="stack" data-testid="section-scores" style={{ gap: 4 }}>
              {sectionScores.map((sc, i) => {
                const sec = packSections?.find((x) => x.name === sc.name);
                const topics = sec ? sectionTopicIds(ix, sec) : [];
                // An origin section has no modules; the study-bank one drills through the bank filter.
                const drillHref = sec?.origins?.includes('study-bank') ? '#/drill?source=bank' : topics.length ? `#/drill?topics=${topics.join(',')}` : null;
                return (
                  <div key={sc.name} className={`section-row${i === weakestSection ? ' weakest' : ''}`} data-testid="section-row">
                    <span>
                      <strong>{sc.name}</strong>: {sc.correct} / {sc.total}, {pct(sc)}%
                      {i === weakestSection && <span className="chip warn" style={{ marginLeft: 8 }}>Weakest</span>}
                    </span>
                    {drillHref && (
                      <a className="btn small" href={drillHref} data-testid="drill-section">
                        Drill this section
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div className="muted small">
            {tabCounts.marked} question{tabCounts.marked === 1 ? ' was' : 's were'} marked for review · {tabCounts.flagged} flagged
          </div>
        </section>
        <section className="card stack">
          <h2>By module</h2>
          {byModule.map((m) => (
            <div key={m.id} className="bar-row">
              <span>{m.name}</span>
              <div className="bar">
                <div className={barClass(pct(m))} style={{ width: `${pct(m)}%` }} />
              </div>
              <span className="pct">
                {m.correct}/{m.total}
              </span>
            </div>
          ))}
          {mostMissed.length > 0 && (
            <>
              <div className="small">
                Most missed:{' '}
                {mostMissed.map(([t, s], i) => (
                  <span key={t}>
                    {i > 0 && ' · '}
                    <strong>{ix.topic.get(t)?.name}</strong> ({s.wrong} of {s.total} wrong)
                  </span>
                ))}
              </div>
              <a href={`#/drill?topics=${mostMissed.map(([t]) => t).join(',')}`}>Drill these topics →</a>
            </>
          )}
        </section>
      </div>

      <section className="stack">
        <h2>Review every question</h2>
        <div className="row" role="tablist" aria-label="Filter questions" style={{ gap: 8 }}>
          {(['all', 'incorrect', 'marked', 'flagged'] as const).map((t) => (
            <button key={t} type="button" role="tab" className="btn seg" aria-selected={tab === t} onClick={() => setTab(t)}>
              {t[0].toUpperCase() + t.slice(1)} {tabCounts[t]}
            </button>
          ))}
        </div>
        {filtered.length === 0 && <p className="muted">Nothing here.</p>}
        {filtered.map((r) => (
          <ReviewItem key={r.q.id} n={r.n} q={r.q} chosen={r.a?.chosen ?? []} correct={!!r.a?.correct} />
        ))}
      </section>
    </main>
  );
}

function ReviewItem({ n, q, chosen, correct }: { n: number; q: Question; chosen: string[]; correct: boolean }) {
  const { ix } = useApp();
  const flag = useFlag(q, 'review');
  if (!ix) return null;
  return (
    <details className="card" style={{ padding: '14px 18px' }}>
      <summary style={{ cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong>Q{n}</strong>
        <span className={`chip ${correct ? 'ok' : 'bad'}`}>{correct ? 'Correct' : chosen.length ? 'Incorrect' : 'Unanswered'}</span>
        <span style={{ flex: '1 1 300px' }}>{q.stem.length > 120 ? q.stem.slice(0, 120) + '…' : q.stem}</span>
      </summary>
      <div className="stack-lg" style={{ marginTop: 16 }}>
        <QuestionMeta q={q} ix={ix} extra={<button type="button" className="btn small" onClick={flag.open}>{flag.flagged ? 'Edit flag' : 'Flag this question'}</button>} />
        <Stem q={q} ix={ix} />
        <OptionFeedback q={q} chosen={chosen} />
        <KeyIdea q={q} />
      </div>
      {flag.dialog}
    </details>
  );
}
