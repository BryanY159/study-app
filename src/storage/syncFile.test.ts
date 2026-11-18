import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeV14Backup, V14_BACKUP_PATH } from '../../test/makeV14Backup';
import { emptyFlags, emptyProgress, legacyAttemptId, type ProgressDoc } from './docs';
import { mergeFlagsForSync, mergeProgressForSync, previewMerge } from './sync';
import { cleanLabel, LegacyBackupSchema, makeSyncFile, parseSyncFile, syncFileName } from './syncFile';

const v14Text = readFileSync(V14_BACKUP_PATH, 'utf8');

describe('sync file', () => {
  it('round-trips, with the app version and device label', () => {
    const p = emptyProgress();
    p.settings.hideFlagged = true;
    const text = JSON.stringify(makeSyncFile(p, emptyFlags(), { device: 'Laptop', appVersion: '9.9.9', now: new Date('2026-11-05T00:00:00Z') }));
    const r = parseSyncFile(text);
    if (!r.ok) throw new Error(r.error);
    expect(r.upgradedFrom).toBeNull();
    expect(r.file).toMatchObject({ kind: 'studyapp-sync', formatVersion: 2, appVersion: '9.9.9', device: 'Laptop', createdAt: '2026-11-05T00:00:00.000Z' });
    expect(r.file.progress.settings.hideFlagged).toBe(true);
  });

  it('uses the app version from package.json by default', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    expect(makeSyncFile(emptyProgress(), emptyFlags(), { device: '' }).appVersion).toBe(pkg.version);
  });

  it('refuses non-files, damaged files and files from a newer app version, with readable errors', () => {
    expect(parseSyncFile('nope')).toEqual({ ok: false, error: expect.stringMatching(/not valid JSON/) });
    expect(parseSyncFile('{"a":1}')).toEqual({ ok: false, error: expect.stringMatching(/not a Study app sync file/) });
    const good = makeSyncFile(emptyProgress(), emptyFlags(), { device: '' });
    expect(parseSyncFile(JSON.stringify({ ...good, formatVersion: 3 }))).toMatchObject({ ok: false, newerVersion: true });
    expect(parseSyncFile(JSON.stringify({ ...good, progress: { ...good.progress, schemaVersion: 2 } }))).toMatchObject({ ok: false, newerVersion: true });
    expect(parseSyncFile(JSON.stringify({ ...good, flags: { schemaVersion: 2 } }))).toMatchObject({ ok: false, newerVersion: true });
    expect(parseSyncFile(JSON.stringify({ ...good, progress: { schemaVersion: 1, attempts: 'x' } }))).toMatchObject({ ok: false, error: expect.stringMatching(/damaged/) });
  });

  it('file name: the device label reduced to a-z, 0-9 and dashes', () => {
    const d = new Date(2026, 10, 17, 9, 0);
    expect(syncFileName('My Laptop!', d)).toBe('study-sync-my-laptop-2026-11-17.json');
    expect(syncFileName('  ', d)).toBe('study-sync-device-2026-11-17.json');
    expect(syncFileName('iPad (2)', d)).toBe('study-sync-ipad-2-2026-11-17.json');
  });

  it('device labels are trimmed, single-spaced and capped at 30 characters', () => {
    expect(cleanLabel('  Old   phone  ')).toBe('Old phone');
    expect(cleanLabel('x'.repeat(40))).toHaveLength(30);
  });
});

describe('v1.4 backups (format 1)', () => {
  it('the fixture is up to date with its generator', () => {
    expect(JSON.parse(v14Text)).toEqual(makeV14Backup());
  });

  it('the fixture is a real v1.4.1 backup: it parses with the v1.4.1 backup schema', () => {
    expect(LegacyBackupSchema.safeParse(JSON.parse(v14Text)).success).toBe(true);
  });

  it('upgrades to format 2, keeping everything v1.4.1 itself would have read', () => {
    const r = parseSyncFile(v14Text);
    if (!r.ok) throw new Error(r.error);
    const v141 = LegacyBackupSchema.parse(JSON.parse(v14Text));
    expect(r.upgradedFrom).toBe(1);
    expect(r.file).toMatchObject({ kind: 'studyapp-sync', formatVersion: 2, appVersion: '1.4', device: '', createdAt: '2026-11-10T18:00:00.000Z' });
    expect(r.file.progress).toEqual(v141.progress);
    expect(r.file.flags).toEqual(v141.flags);
    // The two pre-v1.4 answers got their stable legacy ids.
    const first = r.file.progress.attempts[0];
    expect(first.id).toBe(legacyAttemptId(first));
    expect(r.file.flags.removed).toEqual([{ id: 'flag-mbq0-z0', removedAt: '2026-11-09T11:00:00.000Z' }]);
  });

  it('Merge into an empty device brings in every answer, session and flag', () => {
    const r = parseSyncFile(v14Text);
    if (!r.ok) throw new Error(r.error);
    const empty = { progress: emptyProgress(), flags: emptyFlags() };
    expect(previewMerge(empty, r.file)).toEqual({ answers: 9, sessions: 2, flagsAdded: 2, flagsUpdated: 0, flagsRemoved: 0 });
    const p = mergeProgressForSync(empty.progress, r.file.progress);
    const f = mergeFlagsForSync(empty.flags, r.file.flags);
    expect(p.attempts).toHaveLength(9);
    expect(p.sessions).toHaveLength(2);
    expect(f.flags.map((x) => x.comment)).toEqual(['Asked in class: pale yellow is right.', 'Option C explanation names the wrong vine.']);
  });

  it('Merge into a device that already has some of the same answers adds no duplicates', () => {
    const r = parseSyncFile(v14Text);
    if (!r.ok) throw new Error(r.error);
    const local: ProgressDoc = { ...emptyProgress(), attempts: r.file.progress.attempts.slice(0, 4) };
    const once = mergeProgressForSync(local, r.file.progress);
    expect(once.attempts).toHaveLength(9);
    expect(mergeProgressForSync(once, r.file.progress)).toEqual(once);
  });
});
