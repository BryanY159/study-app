import type { ExamBlueprint, Question } from '../pack/schema';
import { toUnits, type PackIndex } from './packIndex';
import { shuffle, type Rand } from './rng';

export interface MockAssembly {
  questions: Question[];
  /** Shown to the student when the pool can't meet the blueprint. */
  warnings: string[];
}

/**
 * Build a mock exam (spec FR-3, FR-4).
 * 1. Each module gets at least ceil(minModuleShare × count) questions.
 * 2. The rest are drawn at random from the whole pool.
 * Scenario sets are units: never split, kept in pack order, and skipped if
 * they would overshoot the count. Answer options are never touched.
 * Unconfirmed (pre-flagged) questions are left out.
 */
export function assembleMock(
  ix: PackIndex,
  blueprint: ExamBlueprint,
  rand: Rand,
  excludeIds: ReadonlySet<string> = new Set(),
): MockAssembly {
  const count = blueprint.questionCount;
  const minPerModule = Math.ceil(blueprint.minModuleShare * count);
  // Pre-flagged (unconfirmed) questions never count toward a mock score.
  const pool = ix.pack.questions.filter((q) => !excludeIds.has(q.id) && q.status !== 'unconfirmed');
  const units = shuffle(toUnits(pool), rand);
  const moduleOfUnit = (u: Question[]) => ix.moduleOf(u[0]);

  const taken = new Set<Question[]>();
  let total = 0;
  const take = (u: Question[]) => {
    taken.add(u);
    total += u.length;
  };
  const warnings: string[] = [];

  for (const m of ix.pack.modules) {
    let got = 0;
    for (const u of units) {
      if (got >= minPerModule) break;
      if (moduleOfUnit(u) !== m.id || total + u.length > count) continue;
      take(u);
      got += u.length;
    }
    if (got < minPerModule) {
      warnings.push(`Only ${got} ${m.name} question${got === 1 ? '' : 's'} available (the exam blueprint asks for at least ${minPerModule}).`);
    }
  }

  for (const u of units) {
    if (total >= count) break;
    if (!taken.has(u) && total + u.length <= count) take(u);
  }
  if (total < count) warnings.push(`Only ${total} questions available, so this mock has ${total} instead of ${count}.`);

  const ordered = shuffle([...taken], rand).flat();
  return { questions: ordered, warnings };
}
