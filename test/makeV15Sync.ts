// Builds test/fixtures/sample-pack.v1-5-sync.json: a sync file exactly as v1.5.0
// exported it (format 2, flags doc v1, no cards), for answers to the invented Orrin pack.
// Regenerate with:  npx tsx test/makeV15Sync.ts
// (cardsDoc.test.ts checks the committed file still equals this output.)

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeV14Backup } from './makeV14Backup';

export function makeV15Sync(): Record<string, unknown> {
  const b = makeV14Backup() as { progress: Record<string, unknown>; flags: Record<string, unknown> };
  // v1.5 wrote every attempt with an id (legacy ids filled in on read).
  const attempts = (b.progress.attempts as Record<string, unknown>[]).map((a, i) => ({ id: a.id ?? `legacy-${i}`, ...a }));
  return {
    kind: 'studyapp-sync',
    formatVersion: 2,
    appVersion: '1.5.0',
    device: 'Laptop',
    createdAt: '2026-11-16T20:00:00.000Z',
    progress: { ...b.progress, attempts, settings: { hideFlagged: false, activePackId: 'sample-orrin' } },
    flags: b.flags,
  };
}

export const V15_SYNC_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/sample-pack.v1-5-sync.json');

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeFileSync(V15_SYNC_PATH, JSON.stringify(makeV15Sync(), null, 2) + '\n');
  console.log(`wrote ${V15_SYNC_PATH}`);
}
