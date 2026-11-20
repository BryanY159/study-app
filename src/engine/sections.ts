import type { ExamSection, Question } from '../pack/schema';
import type { PackIndex } from './packIndex';
import { pct } from './scoring';

// Mock exam sections: which modules a section covers, and how a finished mock scored in each.
// Pure, so the mock builder, the results screen and the tests share one definition.

export interface SectionScore {
  name: string;
  correct: number;
  total: number;
}

/** The modules a section draws from: its moduleIds plus every module of its groups. */
export function sectionModuleIds(ix: PackIndex, sec: ExamSection): string[] {
  const mods = new Set<string>(sec.moduleIds ?? []);
  for (const gid of sec.groupIds ?? []) for (const m of ix.group.get(gid)?.moduleIds ?? []) mods.add(m);
  return [...mods];
}

/**
 * Which section a question counts toward (index into `sections`), or -1 for none. A question counts
 * toward one section only: an origin section takes precedence over a group or module section, and
 * the first matching section wins within each kind.
 */
export function sectionIndexOf(ix: PackIndex, sections: readonly ExamSection[], q: Question): number {
  const byOrigin = sections.findIndex((s) => s.origins?.includes(q.origin));
  if (byOrigin >= 0) return byOrigin;
  const mod = ix.moduleOf(q);
  return sections.findIndex((s) => !s.origins && sectionModuleIds(ix, s).includes(mod));
}

/** Every topic id in a section's modules (what "Drill this section" preselects). */
export function sectionTopicIds(ix: PackIndex, sec: ExamSection): string[] {
  return sectionModuleIds(ix, sec).flatMap((m) => ix.module.get(m)?.topics.map((t) => t.id) ?? []);
}

/**
 * Score a finished mock per section, in the blueprint's order. A question counts toward one
 * section (see sectionIndexOf); questions in no section are ignored. A section with no
 * questions in the mock (an unfilled section) still appears, with 0 / 0.
 */
export function scoreSections(ix: PackIndex, sections: readonly ExamSection[], results: readonly { questionId: string; correct: boolean }[]): SectionScore[] {
  return sections.map((sec, i) => {
    const mine = results.filter((r) => {
      const q = ix.question.get(r.questionId);
      return !!q && sectionIndexOf(ix, sections, q) === i;
    });
    return { name: sec.name, correct: mine.filter((r) => r.correct).length, total: mine.length };
  });
}

/**
 * Index of the weakest section (lowest percentage; the first on a tie), or -1 when there is
 * nothing to compare: fewer than two sections have questions, or they all scored the same.
 */
export function weakestSectionIndex(scores: readonly SectionScore[]): number {
  const scored = scores.map((s, i) => ({ i, p: pct(s), total: s.total })).filter((s) => s.total > 0);
  if (scored.length < 2 || scored.every((s) => s.p === scored[0].p)) return -1;
  return scored.reduce((best, s) => (s.p < best.p ? s : best)).i;
}
