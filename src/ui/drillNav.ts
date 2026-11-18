import type { DrillRun } from '../state/AppProvider';

// FR-16: moving back through a drill. The drill keeps its live position (`index`);
// `viewing` is an earlier question opened read-only. Viewing never records an
// answer, so accuracy stays honest. Pure functions, so the rules are unit-tested.

export type ChipState = 'correct' | 'incorrect' | 'current' | 'not-yet';

/** The question on screen: the one being viewed, else the live one. */
export const shownIndex = (d: DrillRun): number => d.viewing ?? d.index;

/** One state per question, for the strip. */
export function chipStates(d: DrillRun, correct: (questionId: string, chosen: readonly string[]) => boolean): ChipState[] {
  return d.questionIds.map((id, i) => {
    const chosen = d.answers[id];
    if (i === shownIndex(d)) return 'current';
    if (chosen) return correct(id, chosen) ? 'correct' : 'incorrect';
    return 'not-yet';
  });
}

/** Open question i. Only answered questions before the live one can be viewed; the live one returns to it. */
export function viewAt(d: DrillRun, i: number): DrillRun {
  if (i === d.index) return { ...d, viewing: null };
  if (i < 0 || i > d.index || !d.answers[d.questionIds[i]]) return d;
  return { ...d, viewing: i };
}

export const backToCurrent = (d: DrillRun): DrillRun => ({ ...d, viewing: null });

/** Previous: the answered question before the one on screen, if any. */
export function prev(d: DrillRun): DrillRun {
  const at = shownIndex(d);
  return at > 0 ? viewAt(d, at - 1) : d;
}

/**
 * Next while viewing: step forward through answered questions, back to the live one at the end.
 * (Next on the live, answered question moves the drill on; that's the drill's own `next`.)
 */
export function nextWhileViewing(d: DrillRun): DrillRun {
  if (d.viewing == null) return d;
  return viewAt(d, d.viewing + 1);
}

/** ←/→ work only once feedback is showing (A–D answer the live question), or while viewing. */
export const arrowsActive = (d: DrillRun): boolean => d.viewing != null || !!d.answers[d.questionIds[d.index]];
