import { describe, expect, it } from 'vitest';
import {
  addDays,
  buildQueue,
  deckCounts,
  dueDateFor,
  INTERVAL_DAYS,
  isLearned,
  localDay,
  newCardsRatedToday,
  nextBox,
  nextState,
  requeueAgain,
  type CardState,
} from './leitner';
import { mulberry32 } from './rng';

const at = (day: string, time = '10:00') => new Date(`${day}T${time}:00`); // local time
const st = (box: number, dueDate: string): CardState => ({ box, dueDate, lastReviewedAt: '', updatedAt: '' });

describe('dates', () => {
  it('local day and calendar arithmetic (month ends, leap years, DST-safe)', () => {
    expect(localDay(at('2026-11-17', '23:59'))).toBe('2026-11-17');
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09'); // a DST change day in some zones
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });
});

describe('boxes and intervals', () => {
  it('intervals: box 1 same day, 2 → 1 day, 3 → 3, 4 → 7, 5 → 14', () => {
    expect(INTERVAL_DAYS).toEqual([0, 1, 3, 7, 14]);
    for (let box = 1; box <= 5; box++) expect(dueDateFor(box, '2026-11-17')).toBe(addDays('2026-11-17', INTERVAL_DAYS[box - 1]));
  });

  it('Got it moves up one box, stays at 5; Again goes to 1 from any box', () => {
    expect([1, 2, 3, 4, 5].map((b) => nextBox(b, 'got-it'))).toEqual([2, 3, 4, 5, 5]);
    expect([1, 2, 3, 4, 5].map((b) => nextBox(b, 'again'))).toEqual([1, 1, 1, 1, 1]);
  });

  it('a new card counts as box 1: first Got it → box 2 (tomorrow), first Again → box 1 (today)', () => {
    expect(nextState(undefined, 'got-it', at('2026-11-17'))).toMatchObject({ box: 2, dueDate: '2026-11-18' });
    expect(nextState(undefined, 'again', at('2026-11-17'))).toMatchObject({ box: 1, dueDate: '2026-11-17' });
  });

  it('records when it was reviewed (the newest review wins a sync merge)', () => {
    const now = at('2026-11-17');
    expect(nextState(st(3, '2026-11-17'), 'got-it', now)).toEqual({ box: 4, dueDate: '2026-11-24', lastReviewedAt: now.toISOString(), updatedAt: now.toISOString() });
  });

  it('learned = box 4 or 5', () => {
    expect([1, 2, 3, 4, 5].map((b) => isLearned(st(b, 'x')))).toEqual([false, false, false, true, true]);
    expect(isLearned(undefined)).toBe(false);
  });
});

describe('exam cap', () => {
  const exam = '2026-11-25'; // cap = 11-24
  it('no due date runs past the day before the exam', () => {
    expect(dueDateFor(5, '2026-11-17', exam)).toBe('2026-11-24'); // 14 days → capped
    expect(dueDateFor(4, '2026-11-17', exam)).toBe('2026-11-24'); // 7 days = exactly the cap
    expect(dueDateFor(3, '2026-11-17', exam)).toBe('2026-11-20'); // under the cap: unchanged
  });
  it('on the cap day and after the exam, the normal interval applies (never a date in the past)', () => {
    expect(dueDateFor(3, '2026-11-24', exam)).toBe('2026-11-27');
    expect(dueDateFor(2, '2026-11-26', exam)).toBe('2026-11-27');
  });
  it('without an exam date there is no cap', () => {
    expect(dueDateFor(5, '2026-11-17')).toBe('2026-12-01');
  });
});

describe('daily new-card limit', () => {
  it('counts cards whose FIRST review was today, by local day (across midnight)', () => {
    const reviews = [
      { cardKey: 'p|c1', at: at('2026-11-16', '23:50').toISOString() }, // yesterday
      { cardKey: 'p|c1', at: at('2026-11-17', '00:10').toISOString() }, // not new any more
      { cardKey: 'p|c2', at: at('2026-11-17', '00:05').toISOString() },
      { cardKey: 'p|c3', at: at('2026-11-17', '22:00').toISOString() },
      { cardKey: 'p|c3', at: at('2026-11-17', '22:05').toISOString() },
    ];
    expect(newCardsRatedToday(reviews, '2026-11-17')).toBe(2);
    expect(newCardsRatedToday(reviews, '2026-11-16')).toBe(1);
  });
});

describe('session queue', () => {
  const keys = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6'];
  const states = { k1: st(3, '2026-11-17'), k2: st(1, '2026-11-15'), k3: st(2, '2026-11-17'), k4: st(4, '2026-11-20') }; // k5, k6 new
  const base = { cardKeys: keys, states, today: '2026-11-17', rand: mulberry32(1) };

  it('due first (oldest due, then lowest box, then pack order), then new up to the limit', () => {
    expect(buildQueue({ ...base, mode: 'due-new', newLeft: 1 })).toEqual(['k2', 'k3', 'k1', 'k5']);
    expect(buildQueue({ ...base, mode: 'due-new', newLeft: 20 })).toEqual(['k2', 'k3', 'k1', 'k5', 'k6']);
    expect(buildQueue({ ...base, mode: 'due-new', newLeft: 0 })).toEqual(['k2', 'k3', 'k1']);
  });

  it('Due only leaves out new cards; cram takes everything, shuffled, deterministic per seed', () => {
    expect(buildQueue({ ...base, mode: 'due', newLeft: 20 })).toEqual(['k2', 'k3', 'k1']);
    const a = buildQueue({ ...base, mode: 'cram', newLeft: 0, rand: mulberry32(7) });
    const b = buildQueue({ ...base, mode: 'cram', newLeft: 0, rand: mulberry32(7) });
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual(keys);
  });

  it('Again brings the card back after at least 3 other cards, or at the end', () => {
    const q = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(requeueAgain(q, 0)).toEqual(['a', 'b', 'c', 'd', 'a', 'e', 'f']);
    expect(requeueAgain(q, 1)).toEqual(['a', 'b', 'c', 'd', 'e', 'b', 'f']);
    expect(requeueAgain(q, 3)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'd']); // only 2 left after it → end
    expect(requeueAgain(q, 5)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'f']); // last card → straight after
    expect(requeueAgain(['x'], 0)).toEqual(['x', 'x']);
  });

  it('deck counts: due today, new, learned', () => {
    expect(deckCounts(keys, states, '2026-11-17')).toEqual({ due: 3, new: 2, learned: 1, total: 6 });
  });
});
