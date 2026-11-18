import { describe, expect, it } from 'vitest';
import { emptyFlags, emptyProgress, type ActiveMock, type Flag, type ProgressDoc, type Session } from './docs';
import { docCodec, mergeFlags, mergeProgress } from './sync';

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
