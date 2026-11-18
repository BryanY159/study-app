import { describe, expect, it } from 'vitest';
import { makePack } from '../../test/makePack';
import type { Flag } from '../storage/docs';
import { editableFlag, flagState, flagsToJson, flagsToMarkdown, prunePreflags, seedPreflags } from './flags';

const v1 = makePack({ a: 3 });
const flag: Flag = {
  id: 'f1',
  packId: 'test-pack',
  itemType: 'question',
  packVersion: 1,
  questionId: 'q-a-0002',
  reason: 'answer-wrong',
  comment: 'I think B is right',
  mode: 'drill',
  source: 'user',
  updatedAt: '2026-11-01T00:00:00.000Z',
  createdAt: '2026-11-05T10:00:00.000Z',
};

describe('flagState', () => {
  it('is open while the pack has not fixed it', () => {
    expect(flagState(flag, [v1])).toBe('open');
    const v2 = { ...v1, version: 2 };
    expect(flagState(flag, [v2])).toBe('open');
  });

  it('is resolved when a newer version marks the question flagged-fixed', () => {
    const v2 = { ...v1, version: 2, questions: v1.questions.map((q) => (q.id === 'q-a-0002' ? { ...q, status: 'flagged-fixed' as const } : q)) };
    expect(flagState(flag, [v2])).toBe('resolved');
    // Same version, even if flagged-fixed: still open.
    expect(flagState(flag, [{ ...v2, version: 1 }])).toBe('open');
  });

  it('is missing when the question is gone', () => {
    expect(flagState({ ...flag, questionId: 'q-a-0099' }, [v1])).toBe('missing');
  });
});

describe('flag export', () => {
  const now = new Date('2026-11-06T00:00:00Z');
  it('JSON includes a question snapshot and state', () => {
    const out = JSON.parse(flagsToJson([flag], [v1], now));
    expect(out.kind).toBe('studyapp-flags');
    expect(out.flags[0]).toMatchObject({ questionId: 'q-a-0002', state: 'open', question: { id: 'q-a-0002' } });
  });

  it('Markdown lists stem, options, key and comment', () => {
    const md = flagsToMarkdown([flag], [v1], now);
    expect(md).toContain('## q-a-0002 — Answer wrong');
    expect(md).toContain('Comment: I think B is right');
    expect(md).toContain('Stem of q-a-0002?');
    expect(md).toMatch(/Keyed answer: B/);
  });
});

describe('pre-flags', () => {
  const unconfirmed = (version: number, status: 'unconfirmed' | 'verified' = 'unconfirmed') => ({
    ...v1,
    version,
    questions: v1.questions.map((q) =>
      q.id === 'q-a-0003' ? { ...q, status, preflag: status === 'unconfirmed' ? { reason: 'unclear' as const, note: 'Sources disagree' } : undefined } : q,
    ),
  });

  it('seeds one open flag per unconfirmed question, once', () => {
    const now = new Date('2026-11-06T00:00:00Z');
    const seeded = seedPreflags([], [unconfirmed(2)], now)!;
    expect(seeded).toHaveLength(1);
    expect(seeded[0]).toMatchObject({ questionId: 'q-a-0003', source: 'preflag', reason: 'unclear', comment: '', packVersion: 2 });
    expect(flagState(seeded[0], [unconfirmed(2)])).toBe('open');
    expect(seedPreflags(seeded, [unconfirmed(2)], now)).toBeNull();
  });

  it('does not duplicate a question she already flagged', () => {
    expect(seedPreflags([{ ...flag, questionId: 'q-a-0003' }], [unconfirmed(2)])).toBeNull();
  });

  it('resolves once a newer pack confirms the question', () => {
    const seeded = seedPreflags([], [unconfirmed(2)])![0];
    expect(flagState(seeded, [unconfirmed(3)])).toBe('open');
    expect(flagState(seeded, [unconfirmed(3, 'verified')])).toBe('resolved');
  });
});

describe('prunePreflags', () => {
  const pack = (version: number, status: 'unconfirmed' | 'verified') => ({
    ...v1,
    version,
    questions: v1.questions.map((q) =>
      q.id === 'q-a-0003' ? { ...q, status, preflag: status === 'unconfirmed' ? { reason: 'unclear' as const, note: 'n' } : undefined } : q,
    ),
  });
  const seeded = () => seedPreflags([flag], [pack(2, 'unconfirmed')])!;

  it('keeps pre-flags while the question is still unconfirmed', () => {
    expect(prunePreflags(seeded(), [pack(2, 'unconfirmed')])).toBeNull();
  });

  it('drops an uncommented pre-flag once a newer pack verifies the question', () => {
    expect(prunePreflags(seeded(), [pack(3, 'verified')])).toEqual([flag]);
  });

  it('keeps a commented pre-flag, shown as resolved', () => {
    const withComment = seeded().map((f) => (f.source === 'preflag' ? { ...f, comment: 'Instructor said A' } : f));
    expect(prunePreflags(withComment, [pack(3, 'verified')])).toBeNull();
    expect(flagState(withComment[1], [pack(3, 'verified')])).toBe('resolved');
  });
});

describe('editableFlag', () => {
  it('re-flagging a resolved question starts a new flag instead of editing the resolved one', () => {
    const v2 = { ...v1, version: 2, questions: v1.questions.map((q) => (q.id === 'q-a-0002' ? { ...q, status: 'flagged-fixed' as const } : q)) };
    expect(editableFlag([flag], [v1], 'test-pack', 'q-a-0002')).toBe(flag);
    expect(editableFlag([flag], [v2], 'test-pack', 'q-a-0002')).toBeUndefined();
  });
});

describe('flagState with fixedIn (N-4)', () => {
  const withFix = (version: number, fixedIn: number) => ({ ...v1, version, questions: v1.questions.map((q) => (q.id === 'q-a-0002' ? { ...q, status: 'flagged-fixed' as const, fixedIn } : q)) });
  it('a flag made on the fixed version stays open while later versions leave the question alone', () => {
    const onV5 = { ...flag, packVersion: 5 };
    expect(flagState(onV5, [withFix(5, 5)])).toBe('open');
    expect(flagState(onV5, [withFix(6, 5)])).toBe('open');
    expect(flagState(onV5, [withFix(7, 7)])).toBe('resolved');
  });
  it('a flag made before the fix is resolved', () => {
    expect(flagState({ ...flag, packVersion: 4 }, [withFix(6, 5)])).toBe('resolved');
  });
});
