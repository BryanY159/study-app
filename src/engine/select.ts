import type { Question } from '../pack/schema';
import type { Attempt } from '../storage/docs';
import type { PackIndex } from './packIndex';
import { toUnits } from './packIndex';
import { latestByQuestion } from './progress';
import { shuffle, type Rand } from './rng';

/**
 * Which of the chosen questions to drill. 'bank' is the v2.3.0 value for "study bank only"; it stays
 * as an alias of source 'bank' + filter 'all' so older links keep working.
 */
export type DrillFilter = 'all' | 'unseen' | 'missed' | 'bank';
/** Where the questions come from; combines with any DrillFilter. */
export type DrillSource = 'all' | 'bank';

export interface DrillOptions {
  topicIds: ReadonlySet<string>;
  filter: DrillFilter;
  /** Default 'all'. 'bank' keeps only study-bank questions, then the filter applies on top. */
  source?: DrillSource;
  count: number | 'all';
  /** e.g. flagged questions when "hide flagged" is on. */
  excludeIds?: ReadonlySet<string>;
}

/** Questions eligible for a drill, in pack order. */
export function drillPool(ix: PackIndex, attempts: readonly Attempt[], opts: DrillOptions): Question[] {
  const latest = latestByQuestion(attempts);
  return ix.pack.questions.filter((q) => {
    if (!q.topicIds.some((t) => opts.topicIds.has(t))) return false;
    if (opts.excludeIds?.has(q.id)) return false;
    if ((opts.source === 'bank' || opts.filter === 'bank') && q.origin !== 'study-bank') return false;
    const last = latest.get(q.id);
    if (opts.filter === 'unseen') return !last;
    if (opts.filter === 'missed') return !!last && !last.correct;
    return true;
  });
}

/**
 * Pick drill questions in random order, keeping scenario sets together.
 * A scenario set is never split, so the result can exceed `count` by at most
 * one set's size minus one.
 */
export function buildDrill(ix: PackIndex, attempts: readonly Attempt[], opts: DrillOptions, rand: Rand): Question[] {
  const units = shuffle(toUnits(drillPool(ix, attempts, opts)), rand);
  const limit = opts.count === 'all' ? Infinity : opts.count;
  const out: Question[] = [];
  for (const u of units) {
    if (out.length >= limit) break;
    out.push(...u);
  }
  return out;
}
