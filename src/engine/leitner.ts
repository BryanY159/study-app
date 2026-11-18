import { shuffle, type Rand } from './rng';

// Spaced repetition with five Leitner boxes (FR-13). Pure: no storage, no clock
// reads (the caller passes "now"), so every rule is unit-tested and the content
// repo can use it through @study/pack/engine.
//
//   box:       1         2       3        4        5
//   interval:  same day  1 day   3 days   7 days   14 days
//
// Got it moves a card up one box (max 5); Again sends it to box 1.
// A card that has never been rated is "new"; it counts as box 1, so its first
// Got it puts it in box 2 (see OPEN_QUESTIONS Q3).
// Exam cap: with an exam date, no due date goes past the day before the exam,
// so every card comes round at least once before it.

export const INTERVAL_DAYS = [0, 1, 3, 7, 14] as const;
export const MAX_BOX = 5;
/** A card counts as "learned" from this box on (D6). */
export const LEARNED_BOX = 4;
export const DEFAULT_NEW_PER_DAY = 20;
/** Again brings a card back after at least this many other cards in the same session. */
export const AGAIN_GAP = 3;

export type Rating = 'again' | 'got-it';

export interface CardState {
  box: number;
  /** Local calendar day, YYYY-MM-DD. Due when dueDate <= today. */
  dueDate: string;
  lastReviewedAt: string;
  /** Time of the review that produced this state; the newest wins a sync merge. */
  updatedAt: string;
}

/** Local calendar day (YYYY-MM-DD) of a moment, in the device's time zone. */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** day ± n calendar days (DST-safe: works on the calendar date, not on milliseconds). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return localDay(new Date(y, m - 1, d + n));
}

/** The box a rating moves a card to. */
export function nextBox(current: number | undefined, rating: Rating): number {
  if (rating === 'again') return 1;
  return Math.min((current ?? 1) + 1, MAX_BOX);
}

/** The due date for a card now in `box`, capped by the exam date when there is one. */
export function dueDateFor(box: number, today: string, examDate?: string): string {
  const due = addDays(today, INTERVAL_DAYS[box - 1]);
  if (!examDate) return due;
  const cap = addDays(examDate, -1);
  // On the last day before the exam (or after it), the cap no longer applies.
  if (today >= cap) return due;
  return due < cap ? due : cap;
}

export function nextState(prev: CardState | undefined, rating: Rating, now: Date, examDate?: string): CardState {
  const box = nextBox(prev?.box, rating);
  const at = now.toISOString();
  return { box, dueDate: dueDateFor(box, localDay(now), examDate), lastReviewedAt: at, updatedAt: at };
}

export const isDue = (s: CardState | undefined, today: string): boolean => !!s && s.dueDate <= today;
export const isLearned = (s: CardState | undefined): boolean => !!s && s.box >= LEARNED_BOX;

/** New cards first rated today (counts against the daily limit), from the review log. */
export function newCardsRatedToday(reviews: readonly { cardKey: string; at: string }[], today: string): number {
  const first = new Map<string, string>();
  for (const r of reviews) {
    const cur = first.get(r.cardKey);
    if (!cur || r.at < cur) first.set(r.cardKey, r.at);
  }
  return [...first.values()].filter((at) => localDay(new Date(at)) === today).length;
}

export type QueueMode = 'due-new' | 'due' | 'cram';

/**
 * The cards for a session, in order.
 *  due-new: due cards (oldest due first, then lowest box, then pack order), then new cards up to the limit left today;
 *  due:     due cards only;
 *  cram:    every card in the selection, shuffled; the schedule is not changed by a cram session.
 */
export function buildQueue(a: {
  cardKeys: readonly string[];
  states: Readonly<Record<string, CardState | undefined>>;
  mode: QueueMode;
  today: string;
  newLeft: number;
  rand: Rand;
}): string[] {
  if (a.mode === 'cram') return shuffle([...a.cardKeys], a.rand);
  const order = new Map(a.cardKeys.map((k, i) => [k, i]));
  const due = a.cardKeys
    .filter((k) => isDue(a.states[k], a.today))
    .sort((x, y) => {
      const sx = a.states[x]!;
      const sy = a.states[y]!;
      return sx.dueDate < sy.dueDate ? -1 : sx.dueDate > sy.dueDate ? 1 : sx.box - sy.box || order.get(x)! - order.get(y)!;
    });
  if (a.mode === 'due') return due;
  const fresh = a.cardKeys.filter((k) => !a.states[k]).slice(0, Math.max(0, a.newLeft));
  return [...due, ...fresh];
}

/** After Again: the card comes back after at least AGAIN_GAP other cards, or at the end if fewer remain. */
export function requeueAgain(queue: readonly string[], pos: number): string[] {
  const card = queue[pos];
  const out = [...queue];
  const at = Math.min(pos + 1 + AGAIN_GAP, out.length);
  out.splice(at, 0, card);
  return out;
}

/** Counts per selection, for deck setup: due today, new, learned. */
export function deckCounts(cardKeys: readonly string[], states: Readonly<Record<string, CardState | undefined>>, today: string) {
  let due = 0;
  let fresh = 0;
  let learned = 0;
  for (const k of cardKeys) {
    const s = states[k];
    if (!s) fresh++;
    else {
      if (isDue(s, today)) due++;
      if (isLearned(s)) learned++;
    }
  }
  return { due, new: fresh, learned, total: cardKeys.length };
}
