import type { Question } from '../pack/schema';

export const correctKeys = (q: Question): string[] => q.options.filter((o) => o.correct).map((o) => o.key);

/** single: the chosen key is the key. multi: exact set match. Blank is wrong. */
export function isCorrect(q: Question, chosen: readonly string[]): boolean {
  const keys = correctKeys(q);
  if (chosen.length === 0) return false;
  if (q.type === 'single') return chosen.length === 1 && chosen[0] === keys[0];
  const set = new Set(chosen);
  return set.size === keys.length && keys.every((k) => set.has(k));
}

export interface Score {
  correct: number;
  total: number;
}

export const pct = (s: Score): number => (s.total ? Math.round((100 * s.correct) / s.total) : 0);
