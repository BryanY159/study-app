import type { Question } from '../pack/schema';
import type { Attempt } from '../storage/docs';
import type { PackIndex } from './packIndex';
import { toUnits } from './packIndex';
import { latestByQuestion } from './progress';
import { shuffle, type Rand } from './rng';

export type DrillFilter = 'all' | 'unseen' | 'missed';

export interface DrillOptions {
  topicIds: ReadonlySet<string>;
  filter: DrillFilter;
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
