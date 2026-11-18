import { describe, expect, it } from 'vitest';
import { emptyFlags, emptyProgress, type ActiveMock, type Flag, type ProgressDoc, type Session } from './docs';
import { docCodec, mergeFlags, mergeFlagsForSync, mergeProgress, mergeProgressForSync, nothingNew, previewMerge } from './sync';

const session = (id: string, endedAt: string | null = null): Session => ({
  id,
  mode: 'mock',
  packId: 'test-pack',
  label: 'Mock exam',
  startedAt: `2026-11-01T00:00:0${id.slice(-1)}Z`,
  endedAt,
  questionIds: [],
  marked: [],
  timeLimitMinutes: null,
});
const mock = (sessionId: string): ActiveMock => ({
  sessionId,
  packId: 'test-pack',
  questionIds: ['q1'],
  answers: {},
  marked: [],
  startedAt: '2026-11-01T00:00:00Z',
  timeLimitMinutes: null,
  current: 0,
  warnings: [],
});
const prog = (updatedAt: string, patch: Partial<ProgressDoc> = {}): ProgressDoc => ({ ...emptyProgress(), updatedAt, ...patch });
const flag = (id: string, comment: string, updatedAt: string): Flag => ({
  id,
  packId: 'test-pack',
  packVersion: 1,
  questionId: 'q1',
  reason: 'unclear',
  comment,
  mode: 'drill',
  source: 'user',
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt,
});

describe('mergeProgress', () => {
  it('a finished session beats an unfinished copy, whichever doc is newer', () => {
    const a = prog('2026-11-05', { sessions: [session('s1', '2026-11-02')] });
    const b = prog('2026-11-06', { sessions: [session('s1'), session('s2')] });
    const m = mergeProgress(a, b);
    expect(m.sessions.map((s) => [s.id, s.endedAt])).toEqual([
      ['s1', '2026-11-02'],
      ['s2', null],
    ]);
  });

  it('settings and the exam in progress come from the newer copy; a submitted exam stays submitted', () => {
    const older = prog('2026-11-05', { sessions: [session('s1')], activeMock: mock('s1'), settings: { hideFlagged: false, activePackId: null } });
    const newer = prog('2026-11-06', { sessions: [session('s1', '2026-11-06')], activeMock: null, settings: { hideFlagged: true, activePackId: null } });
    const m = mergeProgress(older, newer);
    expect(m.activeMock).toBeNull();
    expect(m.settings.hideFlagged).toBe(true);
    expect(m.updatedAt).toBe('2026-11-06');
  });

  it('keeps an exam in progress that the newer copy never saw', () => {
    const folder = prog('2026-11-05', { sessions: [session('s1')], activeMock: mock('s1') });
    const freshBrowser = prog('2026-11-06');
    expect(mergeProgress(freshBrowser, folder).activeMock?.sessionId).toBe('s1');
  });
});

describe('restore (restoredAt)', () => {
  it('a copy that missed the restore only contributes what happened after it', () => {
    const att = (id: string, at: string) => ({ id, questionId: 'q1', packId: 'test-pack', sessionId: 's', mode: 'drill' as const, chosen: ['A'], correct: true, at, ms: 1 });
    const restored = prog('2026-11-06T00:00:00Z', { restoredAt: '2026-11-06T00:00:00Z', attempts: [att('b1', '2026-10-30T00:00:00Z')] });
    const stale = prog('2026-11-07T00:00:00Z', { attempts: [att('a1', '2026-11-05T00:00:00Z'), att('a2', '2026-11-07T00:00:00Z')] });
    const m = mergeProgress(stale, restored);
    expect(m.attempts.map((x) => x.id)).toEqual(['b1', 'a2']);
    expect(m.restoredAt).toBe('2026-11-06T00:00:00Z');
    const f = mergeFlags({ ...emptyFlags(), restoredAt: '2026-11-06' }, { ...emptyFlags(), flags: [flag('old', 'x', '2026-11-01'), flag('new', 'y', '2026-11-07')] });
    expect(f.flags.map((x) => x.id)).toEqual(['new']);
  });
});

describe('mergeFlags', () => {
  it('the newer edit of each flag wins, not the newer doc', () => {
    const a = { ...emptyFlags(), updatedAt: '2026-11-09', flags: [flag('f1', 'old', '2026-11-01'), flag('f2', 'new here', '2026-11-08')] };
    const b = { ...emptyFlags(), updatedAt: '2026-11-02', flags: [flag('f1', 'edited', '2026-11-02'), flag('f2', 'older', '2026-11-01')] };
    const m = mergeFlags(a, b);
    expect(m.flags.map((f) => f.comment)).toEqual(['edited', 'new here']);
  });

  it('a flag changed after it was removed comes back; otherwise it stays removed', () => {
    const a = { ...emptyFlags(), flags: [flag('f1', 'x', '2026-11-05'), flag('f2', 'y', '2026-11-01')] };
    const b = {
      ...emptyFlags(),
      removed: [
        { id: 'f1', removedAt: '2026-11-03' },
        { id: 'f2', removedAt: '2026-11-03' },
      ],
    };
    expect(mergeFlags(a, b).flags.map((f) => f.id)).toEqual(['f1']);
  });
});

describe('docCodec', () => {
  it('rejects docs from a newer app version and unparseable text', () => {
    expect(docCodec.parse('progress', { schemaVersion: 2 })).toMatchObject({ ok: false, reason: expect.stringMatching(/newer version/) });
    expect(docCodec.parse('flags', { __unparseable: '{' })).toMatchObject({ ok: false });
    expect(docCodec.parse('flags', emptyFlags())).toMatchObject({ ok: true });
  });
});

// --- Sync import: a file from another device (plan §4.2, D2) -------------------
const a = (id: string, at: string) => ({ id, questionId: 'q1', packId: 'test-pack', sessionId: 's', mode: 'drill' as const, chosen: ['A'], correct: true, at, ms: 1 });
const device = (updatedAt: string, attempts: string[], flags: ReturnType<typeof flag>[] = [], removed: { id: string; removedAt: string }[] = [], patch: Partial<ProgressDoc> = {}) => ({
  progress: prog(updatedAt, { attempts: attempts.map((id, i) => a(id, `2026-11-0${(i % 9) + 1}T00:00:00Z`)), ...patch }),
  flags: { ...emptyFlags(), updatedAt, flags, removed },
});
const merge = (local: ReturnType<typeof device>, incoming: ReturnType<typeof device>) => ({
  progress: mergeProgressForSync(local.progress, incoming.progress),
  flags: mergeFlagsForSync(local.flags, incoming.flags),
});
const attemptIds = (d: { progress: ProgressDoc }) => d.progress.attempts.map((x) => x.id).sort();

describe('sync merge (file from another device)', () => {
  it('adds the other device\'s answers and flags; the preview counts them first', () => {
    const phone = device('2026-11-05', ['p1', 'p2'], [flag('f1', 'phone', '2026-11-02')]);
    const laptop = device('2026-11-06', ['l1', 'l2', 'l3'], [flag('f2', 'laptop', '2026-11-03')]);
    expect(previewMerge(phone, laptop)).toEqual({ answers: 3, sessions: 0, flagsAdded: 1, flagsUpdated: 0, flagsRemoved: 0 });
    const m = merge(phone, laptop);
    expect(attemptIds(m)).toEqual(['l1', 'l2', 'l3', 'p1', 'p2']);
    expect(m.flags.flags.map((f) => f.id)).toEqual(['f1', 'f2']);
  });

  it('is idempotent: importing the same file again changes nothing, and the preview is all zeros', () => {
    const phone = device('2026-11-05', ['p1'], [flag('f1', 'x', '2026-11-02')]);
    const laptop = device('2026-11-06', ['l1'], [flag('f2', 'y', '2026-11-03')], [{ id: 'f9', removedAt: '2026-11-04' }]);
    const once = merge(phone, laptop);
    const twice = merge(once, laptop);
    expect(twice).toEqual(once);
    expect(nothingNew(previewMerge(once, laptop))).toBe(true);
  });

  it('records end up the same whichever device merges first', () => {
    const x = device('2026-11-05', ['p1', 'p2'], [flag('f1', 'x', '2026-11-02')]);
    const y = device('2026-11-06', ['l1'], [flag('f2', 'y', '2026-11-03')]);
    const xy = merge(x, y);
    const yx = merge(y, x);
    expect(attemptIds(xy)).toEqual(attemptIds(yx));
    expect(xy.flags.flags).toEqual(yx.flags.flags);
  });

  it('a restore on one device does not drop the other device\'s older answers (either direction)', () => {
    const restoredA = device('2026-11-08', ['r1'], [], [], { restoredAt: '2026-11-08T00:00:00Z' });
    const b = device('2026-11-06', ['b1', 'b2']); // answers from before A's restore
    expect(attemptIds(merge(b, restoredA))).toEqual(['b1', 'b2', 'r1']);
    const intoA = merge(restoredA, b);
    expect(attemptIds(intoA)).toEqual(['b1', 'b2', 'r1']);
    expect(intoA.progress.restoredAt).toBe('2026-11-08T00:00:00Z'); // this device keeps its own stamp
    expect(merge(b, restoredA).progress.restoredAt).toBe('');
  });

  it('settings and the exam in progress stay this device\'s, even when the file is newer', () => {
    const local = device('2026-11-05', ['p1'], [], [], { sessions: [session('s1')], activeMock: mock('s1'), settings: { hideFlagged: false, activePackId: 'test-pack' } });
    const incoming = device('2026-11-09', ['l1'], [], [], { activeMock: mock('s2'), settings: { hideFlagged: true, activePackId: 'other' } });
    const m = merge(local, incoming);
    expect(m.progress.settings).toEqual({ hideFlagged: false, activePackId: 'test-pack' });
    expect(m.progress.activeMock?.sessionId).toBe('s1');
    expect(m.progress.updatedAt).toBe('2026-11-05');
  });

  it('tombstones hold across devices, in both directions', () => {
    // Device A removed f1; device B still has it, untouched since.
    const A = device('2026-11-06', [], [flag('f2', 'keep', '2026-11-02')], [{ id: 'f1', removedAt: '2026-11-05' }]);
    const B = device('2026-11-04', [], [flag('f1', 'old', '2026-11-02'), flag('f2', 'keep', '2026-11-02')]);
    // B's file merged into A: f1 does not come back.
    expect(merge(A, B).flags.flags.map((f) => f.id)).toEqual(['f2']);
    expect(previewMerge(A, B).flagsAdded).toBe(0);
    // A's file merged into B: f1 is removed there too, and the preview says so.
    expect(previewMerge(B, A).flagsRemoved).toBe(1);
    expect(merge(B, A).flags.flags.map((f) => f.id)).toEqual(['f2']);
    // But if B changed f1 after A removed it, it comes back.
    const Bedited = device('2026-11-07', [], [flag('f1', 'edited later', '2026-11-07')]);
    expect(merge(A, Bedited).flags.flags.map((f) => f.id).sort()).toEqual(['f1', 'f2']);
  });

  it('counts an updated flag (newer edit on the other device)', () => {
    const local = device('2026-11-05', [], [flag('f1', 'old', '2026-11-02')]);
    const incoming = device('2026-11-06', [], [flag('f1', 'new', '2026-11-06')]);
    expect(previewMerge(local, incoming)).toMatchObject({ flagsAdded: 0, flagsUpdated: 1 });
    expect(merge(local, incoming).flags.flags[0].comment).toBe('new');
  });
});
