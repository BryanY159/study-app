import type { ExamBlueprint, ExamSection, Question } from '../pack/schema';
import { toUnits, type PackIndex } from './packIndex';
import { shuffle, type Rand } from './rng';
import { sectionIndexOf } from './sections';

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
 *
 * If the blueprint has `sections`, each section draws exactly its own count from
 * its own modules instead (the per-module floor is not used); see assembleSections.
 */
export function assembleMock(
  ix: PackIndex,
  blueprint: ExamBlueprint,
  rand: Rand,
  excludeIds: ReadonlySet<string> = new Set(),
): MockAssembly {
  const count = blueprint.questionCount;
  if (blueprint.sections) return assembleSections(ix, blueprint.sections, rand, excludeIds);
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

/**
 * Sectioned mock: each section draws exactly its count from the modules it names
 * (directly, or through its groups). Scenario sets stay whole, so a set that
 * wouldn't fit in what's left of a section is skipped. A section that can't be
 * filled warns and the mock is simply shorter: nothing is borrowed from other sections.
 */
function assembleSections(ix: PackIndex, sections: readonly ExamSection[], rand: Rand, excludeIds: ReadonlySet<string>): MockAssembly {
  const pool = ix.pack.questions.filter((q) => !excludeIds.has(q.id) && q.status !== 'unconfirmed');
  const warnings: string[] = [];
  const chosen: Question[][] = [];
  let total = 0;
  let wanted = 0;
  for (const [i, sec] of sections.entries()) {
    // Each question belongs to one section only (origin sections win over group/module sections).
    const units = shuffle(toUnits(pool.filter((q) => sectionIndexOf(ix, sections, q) === i)), rand);
    const picked = pickUnits(units, sec.count);
    chosen.push(...picked);
    const got = picked.reduce((n, u) => n + u.length, 0);
    if (got < sec.count) warnings.push(`Only ${got} ${sec.name} question${got === 1 ? '' : 's'} available (the exam blueprint asks for ${sec.count}).`);
    total += got;
    wanted += sec.count;
  }
  if (total < wanted) warnings.push(`Only ${total} questions available, so this mock has ${total} instead of ${wanted}.`);
  return { questions: shuffle(chosen, rand).flat(), warnings };
}

/**
 * Choose whole units (in the order given, which is already random) whose sizes add up to
 * exactly `count`, or to the largest total below it if no exact fit exists. A plain "take
 * what fits" pass can fill a section with single questions and then reject every scenario
 * set, so this checks which totals are still reachable before taking each unit.
 */
function pickUnits(units: Question[][], count: number): Question[][] {
  const n = units.length;
  // canReach[i][s]: can units i..n-1 add up to exactly s?
  const canReach: boolean[][] = Array.from({ length: n + 1 }, () => new Array<boolean>(count + 1).fill(false));
  canReach[n][0] = true;
  for (let i = n - 1; i >= 0; i--) {
    const len = units[i].length;
    for (let s = 0; s <= count; s++) canReach[i][s] = canReach[i + 1][s] || (s >= len && canReach[i + 1][s - len]);
  }
  let target = count;
  while (target > 0 && !canReach[0][target]) target--;
  const picked: Question[][] = [];
  let left = target;
  for (let i = 0; i < n && left > 0; i++) {
    const len = units[i].length;
    if (len <= left && canReach[i + 1][left - len]) {
      picked.push(units[i]);
      left -= len;
    }
  }
  return picked;
}
