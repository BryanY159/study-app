// Builds test/fixtures/sample-pack.v1-4-backup.json: a backup file in the exact
// shape v1.4.1's "Download backup" wrote, for answers to the invented Orrin pack.
// Regenerate with:  npx tsx test/makeV14Backup.ts
// (syncFile.test.ts checks the committed file still equals this output.)

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACK = 'sample-orrin';

type Raw = Record<string, unknown>;

const attempt = (n: number, questionId: string, sessionId: string, mode: 'drill' | 'mock', chosen: string[], correct: boolean, at: string, withId = true): Raw => ({
  ...(withId ? { id: `att-${n}` } : {}),
  questionId,
  packId: PACK,
  sessionId,
  mode,
  chosen,
  correct,
  at,
  ms: 4000 + n * 250,
});

export function makeV14Backup(): Raw {
  const drill = 'drill-mbq1-a1';
  const mock = 'mock-mbq2-b2';
  const mockQs = ['q-alpha-0003', 'q-alpha-0004', 'q-beta-0003', 'q-beta-0004', 'q-gamma-0001', 'q-gamma-0002'];
  return {
    kind: 'studyapp-backup',
    createdAt: '2026-11-10T18:00:00.000Z',
    progress: {
      schemaVersion: 1,
      updatedAt: '2026-11-10T17:30:00.000Z',
      restoredAt: '',
      attempts: [
        // Two answers from before v1.4 have no id (v1.4 gives them one from session|question|time).
        attempt(1, 'q-alpha-0001', drill, 'drill', ['A'], true, '2026-11-09T10:00:10.000Z', false),
        attempt(2, 'q-alpha-0002', drill, 'drill', ['A'], false, '2026-11-09T10:00:40.000Z', false),
        attempt(3, 'q-beta-0001', drill, 'drill', ['A'], true, '2026-11-09T10:01:15.000Z'),
        attempt(4, mockQs[0], mock, 'mock', ['C'], true, '2026-11-10T17:20:00.000Z'),
        attempt(5, mockQs[1], mock, 'mock', ['A'], false, '2026-11-10T17:20:00.000Z'),
        attempt(6, mockQs[2], mock, 'mock', ['D'], true, '2026-11-10T17:20:00.000Z'),
        attempt(7, mockQs[3], mock, 'mock', [], false, '2026-11-10T17:20:00.000Z'),
        attempt(8, mockQs[4], mock, 'mock', ['B'], true, '2026-11-10T17:20:00.000Z'),
        attempt(9, mockQs[5], mock, 'mock', ['A'], true, '2026-11-10T17:20:00.000Z'),
      ],
      sessions: [
        { id: drill, mode: 'drill', packId: PACK, label: 'Drill · Glowroot anatomy', startedAt: '2026-11-09T10:00:00.000Z', endedAt: '2026-11-09T10:01:30.000Z', questionIds: ['q-alpha-0001', 'q-alpha-0002', 'q-beta-0001'], marked: [], timeLimitMinutes: null },
        { id: mock, mode: 'mock', packId: PACK, label: 'Mock exam', startedAt: '2026-11-10T17:00:00.000Z', endedAt: '2026-11-10T17:20:00.000Z', questionIds: mockQs, marked: [mockQs[3]], timeLimitMinutes: 30 },
      ],
      activeMock: null,
      settings: { hideFlagged: false, activePackId: PACK },
    },
    flags: {
      schemaVersion: 1,
      updatedAt: '2026-11-10T17:25:00.000Z',
      restoredAt: '',
      flags: [
        { id: 'flag-mbq3-c3', packId: PACK, packVersion: 1, questionId: 'q-beta-0002', reason: 'explanation-wrong', comment: 'Option C explanation names the wrong vine.', mode: 'drill', source: 'user', createdAt: '2026-11-09T10:00:55.000Z', updatedAt: '2026-11-09T10:00:55.000Z' },
        { id: `preflag-${PACK}-q-gamma-0004`, packId: PACK, packVersion: 1, questionId: 'q-gamma-0004', reason: 'unclear', comment: 'Asked in class: pale yellow is right.', mode: 'review', source: 'preflag', createdAt: '2026-11-08T09:00:00.000Z', updatedAt: '2026-11-10T17:25:00.000Z' },
      ],
      removed: [{ id: 'flag-mbq0-z0', removedAt: '2026-11-09T11:00:00.000Z' }],
    },
  };
}

export const V14_BACKUP_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/sample-pack.v1-4-backup.json');

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeFileSync(V14_BACKUP_PATH, JSON.stringify(makeV14Backup(), null, 2) + '\n');
  console.log(`wrote ${V14_BACKUP_PATH}`);
}
