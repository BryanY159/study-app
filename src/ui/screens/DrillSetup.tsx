import { useMemo, useState } from 'react';
import { mulberry32, randomSeed } from '../../engine/rng';
import { buildDrill, drillPool, type DrillFilter } from '../../engine/select';
import type { PackIndex } from '../../engine/packIndex';
import { useApp } from '../../state/AppProvider';
import { navigate, type Route } from '../router';
import { NoPack } from './NoPack';

const COUNTS = [10, 20, 40] as const;

export function drillLabel(ix: PackIndex, topicIds: ReadonlySet<string>): string {
  const full: string[] = [];
  let partial = 0;
  for (const m of ix.pack.modules) {
    const on = m.topics.filter((t) => topicIds.has(t.id)).length;
    if (on === m.topics.length) full.push(m.name);
    else if (on > 0) partial += on;
  }
  const parts = [...full];
  if (partial) parts.push(`${partial} topic${partial === 1 ? '' : 's'}`);
  return `Drill · ${parts.join(' + ')}`;
}

export function DrillSetup({ route }: { route: Route }) {
  const { ix, progress, flags, updateProgress, startSession, setDrill } = useApp();
  const preset = route.query.get('topics')?.split(',').filter(Boolean);
  const [topics, setTopics] = useState<Set<string>>(() => new Set(preset?.length ? preset : ix ? [...ix.topic.keys()] : []));
  const [filter, setFilter] = useState<DrillFilter>(() => (route.query.get('filter') as DrillFilter) || 'all');
  const [count, setCount] = useState<number | 'all'>(20);
  const hideFlagged = progress.settings.hideFlagged;

  const attempts = progress.attempts;
  const excludeIds = useMemo(
    () => new Set(hideFlagged ? flags.flags.map((f) => f.questionId) : []),
    [hideFlagged, flags.flags],
  );
  const poolFor = (f: DrillFilter, ts: ReadonlySet<string>) => (ix ? drillPool(ix, attempts, { topicIds: ts, filter: f, count: 'all', excludeIds }) : []);
  const available = poolFor(filter, topics).length;

  if (!ix) return <NoPack />;

  const perTopic = (id: string) => poolFor(filter, new Set([id])).length;
  const toggle = (ids: string[], on: boolean) =>
    setTopics((prev) => {
      const next = new Set(prev);
      for (const id of ids) on ? next.add(id) : next.delete(id);
      return next;
    });

  const start = () => {
    const qs = buildDrill(ix, attempts, { topicIds: topics, filter, count, excludeIds }, mulberry32(randomSeed()));
    if (!qs.length) return;
    const questionIds = qs.map((q) => q.id);
    const sessionId = startSession({ mode: 'drill', packId: ix.pack.packId, label: drillLabel(ix, topics), questionIds });
    setDrill({ sessionId, questionIds, index: 0, answers: {} });
    navigate('/drill/run');
  };
  const n = count === 'all' ? available : Math.min(count, available);

  return (
    <main className="page">
      <div className="grid-aside">
        <section className="stack-lg">
          <div>
            <h1>Set up a drill</h1>
            <p className="muted" style={{ marginTop: 6 }}>
              Choose topics. You'll see the answer and explanation after each question.
            </p>
          </div>
          {ix.pack.modules.map((m) => {
            const ids = m.topics.map((t) => t.id);
            const all = ids.every((id) => topics.has(id));
            const some = ids.some((id) => topics.has(id));
            return (
              <fieldset key={m.id}>
                <legend>{m.topics.length} topics</legend>
                <label className="check" style={{ fontWeight: 600 }}>
                  <input
                    type="checkbox"
                    checked={all}
                    ref={(el) => {
                      if (el) el.indeterminate = some && !all;
                    }}
                    onChange={(e) => toggle(ids, e.target.checked)}
                  />
                  {m.name}
                </label>
                <div className="topic-list">
                  {m.topics.map((t) => (
                    <label key={t.id} className="check">
                      <input type="checkbox" checked={topics.has(t.id)} onChange={(e) => toggle([t.id], e.target.checked)} />
                      <span>{t.name}</span>
                      <span className="n">{perTopic(t.id)}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          })}
        </section>

        <aside className="card stack-lg" style={{ position: 'sticky', top: 16 }}>
          <div className="stack" style={{ gap: 8 }}>
            <div style={{ fontWeight: 600 }}>Number of questions</div>
            <div className="row" style={{ gap: 8 }}>
              {COUNTS.map((c) => (
                <button key={c} type="button" className="btn seg" aria-pressed={count === c} onClick={() => setCount(c)}>
                  {c}
                </button>
              ))}
              <button type="button" className="btn seg" aria-pressed={count === 'all'} onClick={() => setCount('all')}>
                All ({available})
              </button>
            </div>
          </div>
          <div className="stack" style={{ gap: 0 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Which questions</div>
            {(
              [
                ['all', 'All in selected topics'],
                ['unseen', 'Not seen yet'],
                ['missed', 'Previously missed'],
              ] as const
            ).map(([f, label]) => (
              <label key={f} className="check">
                <input type="radio" name="filter" checked={filter === f} onChange={() => setFilter(f)} />
                {label} {f !== 'all' && <span className="muted">({poolFor(f, topics).length})</span>}
              </label>
            ))}
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={hideFlagged}
              onChange={(e) => updateProgress((p) => ({ ...p, settings: { ...p.settings, hideFlagged: e.target.checked } }))}
            />
            Hide flagged questions
          </label>
          <button type="button" className="btn primary big" disabled={n === 0} onClick={start}>
            Start drill · {n} question{n === 1 ? '' : 's'}
          </button>
          <p className="small muted">
            {topics.size} topic{topics.size === 1 ? '' : 's'} selected · {available} question{available === 1 ? '' : 's'} available
          </p>
        </aside>
      </div>
    </main>
  );
}
