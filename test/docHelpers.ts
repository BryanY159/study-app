import { emptyFlags, emptyProgress, type Attempt, type Flag, type FlagsDoc, type ProgressDoc } from '../src/storage/docs';

// Tiny progress / flags docs for storage tests. Ids sort, times are fixed.

export const att = (id: string, at?: string): Attempt => ({
  id,
  questionId: 'q-a-0001',
  packId: 'test-pack',
  sessionId: 's1',
  mode: 'drill',
  chosen: ['A'],
  correct: true,
  at: at ?? `2026-11-01T00:00:${String(Number(id.replace(/\D/g, '')) % 60).padStart(2, '0')}.000Z`,
  ms: 1000,
});

export const prog = (updatedAt: string, attemptIds: string[] = []): ProgressDoc => ({ ...emptyProgress(), updatedAt, attempts: attemptIds.map((id) => att(id)) });

export const flag = (id: string, comment = '', updatedAt = '2026-11-02T00:00:00.000Z'): Flag => ({
  id,
  packId: 'test-pack',
  packVersion: 1,
  questionId: `q-a-000${id.slice(-1)}`,
  reason: 'answer-wrong',
  comment,
  mode: 'review',
  source: 'user',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt,
});

export const flagsDoc = (updatedAt: string, flags: Flag[], removed: FlagsDoc['removed'] = []): FlagsDoc => ({ ...emptyFlags(), updatedAt, flags, removed });
