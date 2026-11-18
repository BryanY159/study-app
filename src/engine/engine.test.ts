import { describe, expect, it } from 'vitest';
import { attempt, makePack, makeQuestion } from '../../test/makePack';
import { emptyProgress } from '../storage/docs';
import { indexPack, toUnits } from './packIndex';
import { missedIds, moduleStats, overallStats, recentSessions, topicStats } from './progress';
import { mulberry32, shuffle } from './rng';
import { isCorrect } from './scoring';
import { buildDrill, drillPool } from './select';

describe('rng', () => {
  it('is deterministic per seed and shuffles without losing items', () => {
    const a = shuffle([1, 2, 3, 4, 5, 6], mulberry32(7));
    const b = shuffle([1, 2, 3, 4, 5, 6], mulberry32(7));
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('scoring', () => {
  const q = makeQuestion('q-x-0001', 't', null, 2); // key C
  it('single: only the key is correct', () => {
    expect(isCorrect(q, ['C'])).toBe(true);
    expect(isCorrect(q, ['A'])).toBe(false);
    expect(isCorrect(q, [])).toBe(false);
    expect(isCorrect(q, ['C', 'A'])).toBe(false);
  });
  it('multi: exact set match', () => {
    const m = { ...q, type: 'multi' as const, options: q.options.map((o, i) => ({ ...o, correct: i < 2 })) };
    expect(isCorrect(m, ['B', 'A'])).toBe(true);
    expect(isCorrect(m, ['A'])).toBe(false);
    expect(isCorrect(m, ['A', 'B', 'C'])).toBe(false);
  });
});

describe('select', () => {
  const ix = indexPack(makePack({ a: 10, b: 10 }, { groups: 1, groupSize: 3 }));
  const all = { topicIds: new Set(['a-t']), filter: 'all' as const, count: 'all' as const };

  it('filters by topic, unseen and missed', () => {
    const attempts = [attempt('q-a-0004', true), attempt('q-a-0005', false), attempt('q-a-0006', false), attempt('q-a-0006', true)];
    expect(drillPool(ix, attempts, all)).toHaveLength(10);
    expect(drillPool(ix, attempts, { ...all, filter: 'unseen' })).toHaveLength(7);
    expect(drillPool(ix, attempts, { ...all, filter: 'missed' }).map((q) => q.id)).toEqual(['q-a-0005']);
    expect(drillPool(ix, [], { ...all, excludeIds: new Set(['q-a-0001']) })).toHaveLength(9);
  });

  it('keeps scenario sets together and in order', () => {
    for (let seed = 0; seed < 50; seed++) {
      const qs = buildDrill(ix, [], { ...all, count: 'all' }, mulberry32(seed));
      const ids = qs.map((q) => q.id);
      const i = ids.indexOf('q-a-0001');
      expect(ids.slice(i, i + 3)).toEqual(['q-a-0001', 'q-a-0002', 'q-a-0003']);
    }
  });

  it('respects the count, overshooting only to finish a scenario set', () => {
    for (let seed = 0; seed < 50; seed++) {
      const n = buildDrill(ix, [], { ...all, count: 5 }, mulberry32(seed)).length;
      expect(n).toBeGreaterThanOrEqual(5);
      expect(n).toBeLessThanOrEqual(7);
    }
  });

  it('groups units by scenario', () => {
    expect(toUnits(ix.pack.questions).map((u) => u.length).slice(0, 2)).toEqual([3, 1]);
  });
});

describe('progress', () => {
  const ix = indexPack(makePack({ a: 30, b: 5 }));

  it('handles no attempts', () => {
    expect(overallStats(ix, [])).toMatchObject({ correct: 0, total: 0, pct: 0 });
    expect(topicStats(ix, []).every((t) => t.total === 0)).toBe(true);
  });

  it('per-topic accuracy uses only the last 20 attempts', () => {
    // 5 old wrong attempts, then 20 right ones: the wrong ones fall out of the window.
    const attempts = [
      ...Array.from({ length: 5 }, (_, i) => attempt(`q-a-${String(i + 1).padStart(4, '0')}`, false)),
      ...Array.from({ length: 20 }, (_, i) => attempt(`q-a-${String(i + 6).padStart(4, '0')}`, true)),
    ];
    const a = topicStats(ix, attempts).find((t) => t.topicId === 'a-t')!;
    expect(a).toMatchObject({ correct: 20, total: 20, pct: 100 });
    const one = topicStats(ix, [...attempts, attempt('q-a-0026', false)]).find((t) => t.topicId === 'a-t')!;
    expect(one).toMatchObject({ correct: 19, total: 20, pct: 95 });
  });

  it('sorts topics weakest first with unattempted topics last', () => {
    const stats = topicStats(ix, [attempt('q-a-0001', true), attempt('q-b-0001', false)]);
    expect(stats.map((t) => t.topicId)).toEqual(['b-t', 'a-t']);
    expect(topicStats(indexPack(makePack({ a: 3, b: 3, c: 3 })), [attempt('q-b-0001', true)]).at(-1)!.total).toBe(0);
  });

  it('module and overall stats use the latest attempt per question', () => {
    const attempts = [attempt('q-a-0001', false), attempt('q-a-0001', true), attempt('q-a-0002', false), attempt('q-b-0001', true)];
    expect(moduleStats(ix, attempts)[0]).toMatchObject({ seen: 2, available: 30, correct: 1, total: 2, pct: 50 });
    expect(overallStats(ix, attempts)).toMatchObject({ correct: 2, total: 3, pct: 67 });
    expect([...missedIds(attempts)]).toEqual(['q-a-0002']);
  });

  it('lists recent sessions newest first with scores', () => {
    const p = emptyProgress();
    p.sessions = ['s1', 's2', 's3'].map((id) => ({ id, mode: 'drill', packId: 'test-pack', label: id, startedAt: '', endedAt: null, questionIds: [], marked: [], timeLimitMinutes: null }));
    p.attempts = [attempt('q-a-0001', true, 's1'), attempt('q-a-0002', false, 's3'), attempt('q-a-0003', true, 's3')];
    expect(recentSessions(p).map((r) => [r.session.id, r.score.correct, r.score.total])).toEqual([
      ['s3', 1, 2],
      ['s1', 1, 1],
    ]);
  });
});
