import { useMemo, useState } from 'react';
import { missedIds, nodeStats, overallStats, recentSessions, topicStats, TOPIC_WINDOW, WEAKEST_DRILLED, WEAKEST_SHOWN, weakestTopics } from '../../engine/progress';
import { useApp } from '../../state/AppProvider';
import { CardsTile, useCardStats } from '../components/CardsTile';
import { BackupReminder } from '../components/SyncExport';
import { SetAsideWarning } from '../components/SetAsideWarning';
import { TopicTree } from '../components/TopicTree';
import { buildTree, topicPath } from '../topicTree';
import { useBreakpoint } from '../useBreakpoint';
import { useExpanded } from '../useExpanded';
import { Welcome } from './Welcome';

export function barClass(p: number): string {
  return p < 60 ? 'low' : p < 75 ? 'mid' : '';
}

const dayNumber = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000;

export function daysUntil(isoDate: string, now = new Date()): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  return dayNumber(new Date(y, m - 1, d)) - dayNumber(now);
}

export function formatWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const days = dayNumber(now) - dayNumber(d);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function Dashboard() {
  const { ix, progress, flags } = useApp();
  const phone = useBreakpoint() === 'phone';
  const [showAllTopics, setShowAllTopics] = useState(false);
  const cardStats = useCardStats();
  const tree = useMemo(() => (ix ? buildTree(ix) : []), [ix]);
  const expanded = useExpanded('home', ix?.pack.packId ?? '');
  const stats = useMemo(() => {
    if (!ix) return null;
    const relevant = progress.attempts.filter((a) => a.packId === ix.pack.packId);
    return {
      overall: overallStats(ix, relevant),
      topics: topicStats(ix, relevant),
      attempts: relevant,
      missed: [...missedIds(relevant)].filter((id) => ix.question.has(id)).length,
    };
  }, [ix, progress.attempts]);

  if (!ix || !stats) return <Welcome />;
  const { pack } = ix;
  const sessions = recentSessions({ ...progress, sessions: progress.sessions.filter((s) => s.packId === pack.packId) }, 5);
  const attempted = stats.topics.filter((t) => t.total > 0);
  const weakest = attempted.slice(0, WEAKEST_DRILLED).map((t) => t.topicId);
  const shown = weakestTopics(stats.topics, showAllTopics);
  const weakestHref = `#/drill?topics=${weakest.join(',')}`;
  const weakestLabel = `Drill weakest ${weakest.length === 1 ? 'topic' : `${weakest.length} topics`}`;
  const days = pack.examDate ? daysUntil(pack.examDate) : null;
  const flagCount = flags.flags.filter((f) => f.packId === pack.packId).length;
  const bp = pack.examBlueprint;

  return (
    <main className="page">
      <BackupReminder />
      <SetAsideWarning />
      <div className="spread">
        <div>
          <div className="eyebrow">
            {pack.title} · {pack.modules.map((m) => m.name).join(', ')}
          </div>
          <h1 style={{ marginTop: 6, fontSize: 30 }}>Welcome back</h1>
        </div>
        {days !== null && days >= 0 && (
          <div className="countdown">
            {days === 0 ? 'Exam is today' : `Exam in ${days} day${days === 1 ? '' : 's'}`} ·{' '}
            {new Date(pack.examDate + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </div>
        )}
      </div>

      <CardsTile />

      <div className="grid-3">
        <a href="#/drill" className="action-card primary">
          <span className="title">Start a drill</span>
          <span className="sub">Pick topics · feedback after every question</span>
        </a>
        <a href="#/mock" className="action-card">
          <span className="title">Take a mock exam</span>
          <span className="sub">
            {bp.questionCount} questions · {bp.timeLimitMinutes} minutes · feedback at the end
          </span>
        </a>
        <div className="action-card">
          <span className="title">Review missed &amp; flagged</span>
          <span className="sub">
            <a href="#/drill?filter=missed">{stats.missed} missed</a> · <a href="#/flags">{flagCount} flagged</a>
          </span>
        </div>
      </div>
      {phone && weakest.length > 0 && (
        <div className="row" data-testid="weakest-chip-row">
          <a className="btn small" href={weakestHref} data-testid="drill-weakest-chip">
            {weakestLabel} →
          </a>
        </div>
      )}

      <div className="grid-main">
        <section className="card" data-testid="topics">
          {/* FR-17: the action sits in the section header, above the list, on every screen size. */}
          <div className="spread" style={{ alignItems: 'center', marginBottom: 4 }}>
            <h2>Weakest topics</h2>
            {weakest.length > 0 && (
              <a className="btn small primary" href={weakestHref} data-testid="drill-weakest">
                {weakestLabel}
              </a>
            )}
          </div>
          <p className="small muted" style={{ marginBottom: 8 }}>
            Accuracy over the last {TOPIC_WINDOW} answers per topic, weakest first
          </p>
          {attempted.length === 0 && <p className="muted">No answers yet. Start a drill to see your weak spots here.</p>}
          {shown.map((t) => (
            <div key={t.topicId} className="bar-row" data-testid="topic-row">
              <div>
                <div style={{ fontWeight: 500 }}>{t.name}</div>
                <div className="small muted">
                  {topicPath(ix, t.topicId).join(' › ')} · {t.total} answered
                </div>
              </div>
              <div className="bar">
                <div className={barClass(t.pct)} style={{ width: `${t.pct}%` }} />
              </div>
              <span className="pct">{t.pct}%</span>
              {cardStats?.perTopic.get(t.topicId) && (
                <span className="small muted topic-cards" data-testid="topic-cards">
                  Cards {cardStats.perTopic.get(t.topicId)!.learned}/{cardStats.perTopic.get(t.topicId)!.total} learned
                </span>
              )}
            </div>
          ))}
          {attempted.length > WEAKEST_SHOWN && (
            <button type="button" className="btn small" style={{ marginTop: 8 }} aria-expanded={showAllTopics} onClick={() => setShowAllTopics((v) => !v)}>
              {showAllTopics ? 'Show fewer' : `Show all topics (${attempted.length})`}
            </button>
          )}
        </section>

        <section className="card stack-lg">
          <div>
            <h2 style={{ marginBottom: 4 }}>Overall</h2>
            <p data-testid="overall">
              {stats.overall.total ? `${stats.overall.pct}% · ${stats.overall.correct} of ${stats.overall.seen} questions right on the latest try` : 'No answers yet'}
            </p>
          </div>
          <div>
            <h2 style={{ marginBottom: 4 }}>{ix.group.size ? 'By group and module' : 'By module'}</h2>
            <TopicTree
              stackTopicMeta
              label="Progress by group, module and topic"
              nodes={tree}
              expanded={expanded}
              meta={(n) => {
                const st = nodeStats(ix, stats.attempts, n.topicIds);
                return (
                  <>
                    {st.seen ? `${st.pct}% · ` : ''}
                    {st.seen} of {st.available} seen
                    {n.kind === 'topic' && cardStats?.perTopic.get(n.refId) && ` · cards ${cardStats.perTopic.get(n.refId)!.learned}/${cardStats.perTopic.get(n.refId)!.total}`}
                  </>
                );
              }}
            />
          </div>
          {phone ? (
            <details className="collapse" data-testid="recent-sessions">
              <summary>Show recent sessions</summary>
              <RecentSessions sessions={sessions} />
            </details>
          ) : (
            <div data-testid="recent-sessions">
              <h2 style={{ marginBottom: 4 }}>Recent sessions</h2>
              <RecentSessions sessions={sessions} />
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function RecentSessions({ sessions }: { sessions: ReturnType<typeof recentSessions> }) {
  return (
    <>
      {sessions.length === 0 && <p className="muted">None yet.</p>}
      {sessions.map(({ session, score }) => (
        <div key={session.id} className="list-row" data-testid="session-row">
          <div className="stack" style={{ gap: 0 }}>
            <span style={{ fontWeight: 500 }}>{session.mode === 'mock' ? <a href={`#/mock/results/${session.id}`}>{session.label}</a> : session.label}</span>
            <span className="small muted">
              {formatWhen(session.startedAt)} · {score.total} question{score.total === 1 ? '' : 's'}
            </span>
          </div>
          <span style={{ fontWeight: 600 }}>
            {score.correct}/{score.total}
          </span>
        </div>
      ))}
    </>
  );
}
