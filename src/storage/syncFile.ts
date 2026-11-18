import { z } from 'zod';
import { FlagsDocSchema, ProgressDocSchema, type FlagsDoc, type ProgressDoc } from './docs';

// The one file format for moving data between devices AND for backups (D1).
//   format 1 = the v1.4 backup: { kind: 'studyapp-backup', createdAt, progress, flags }
//   format 2 = the sync file:   { kind: 'studyapp-sync', formatVersion: 2, appVersion, device, createdAt, progress, flags }
// Older formats are upgraded on import, one step at a time (1 → 2, later 2 → 3),
// so each new format only adds one upgrade function.
// This lives in storage, not in @study/pack: it's app data, not pack format.

export const SYNC_FORMAT = 2;

/** The v1.4 backup file, exactly as v1.4.1 wrote and read it. */
export const LegacyBackupSchema = z.object({
  kind: z.literal('studyapp-backup'),
  createdAt: z.string(),
  progress: ProgressDocSchema,
  flags: FlagsDocSchema,
});

export const SyncFileSchema = z.object({
  kind: z.literal('studyapp-sync'),
  formatVersion: z.literal(SYNC_FORMAT),
  appVersion: z.string(),
  /** The exporting device's label, "" if it had none. */
  device: z.string(),
  createdAt: z.string(),
  progress: ProgressDocSchema,
  flags: FlagsDocSchema,
});
export type SyncFile = z.infer<typeof SyncFileSchema>;

export function makeSyncFile(progress: ProgressDoc, flags: FlagsDoc, opts: { device: string; appVersion?: string; now?: Date }): SyncFile {
  return {
    kind: 'studyapp-sync',
    formatVersion: SYNC_FORMAT,
    appVersion: opts.appVersion ?? __APP_VERSION__,
    device: opts.device,
    createdAt: (opts.now ?? new Date()).toISOString(),
    progress,
    flags,
  };
}

/** Format 1 → 2. The docs were already upgraded by their own schemas (attempt ids, stamps, tombstones). */
export function upgradeV1Backup(b: z.infer<typeof LegacyBackupSchema>): SyncFile {
  return { kind: 'studyapp-sync', formatVersion: SYNC_FORMAT, appVersion: '1.4', device: '', createdAt: b.createdAt, progress: b.progress, flags: b.flags };
}

export type ParsedSyncFile = { ok: true; file: SyncFile; upgradedFrom: number | null } | { ok: false; error: string; newerVersion?: boolean };

const NEWER = 'This file was made by a newer version of the app. Update the app (reload the page) and try again.';

export function parseSyncFile(text: string): ParsedSyncFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This file is not a sync file or backup (it is not valid JSON).' };
  }
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const docVersion = (d: unknown) => (d && typeof d === 'object' ? (d as { schemaVersion?: unknown }).schemaVersion : undefined);
  const newerDoc = [docVersion(o.progress), docVersion(o.flags)].some((v) => typeof v === 'number' && v > 1);
  if (o.kind === 'studyapp-sync' && typeof o.formatVersion === 'number' && o.formatVersion > SYNC_FORMAT) return { ok: false, error: NEWER, newerVersion: true };
  if ((o.kind === 'studyapp-sync' || o.kind === 'studyapp-backup') && newerDoc) return { ok: false, error: NEWER, newerVersion: true };

  if (o.kind === 'studyapp-backup') {
    const r = LegacyBackupSchema.safeParse(raw);
    return r.success ? { ok: true, file: upgradeV1Backup(r.data), upgradedFrom: 1 } : { ok: false, error: DAMAGED };
  }
  const r = SyncFileSchema.safeParse(raw);
  return r.success ? { ok: true, file: r.data, upgradedFrom: null } : { ok: false, error: DAMAGED };
}

const DAMAGED = 'This file is not a Study app sync file or backup, or it is damaged.';

/** study-sync-<device>-<YYYY-MM-DD>.json, with the label reduced to a-z, 0-9 and dashes. */
export function syncFileName(label: string, now = new Date()): string {
  const slug =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'device';
  return `study-sync-${slug}-${dateStamp(now)}.json`;
}

export const dateStamp = (d = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Answer and flag counts, for the Replace confirmation. */
export const fileCounts = (b: Pick<SyncFile, 'progress' | 'flags'>) => ({ attempts: b.progress.attempts.length, flags: b.flags.flags.length });

export const MAX_LABEL = 30;
export const cleanLabel = (s: string): string => s.trim().replace(/\s+/g, ' ').slice(0, MAX_LABEL).trim();
