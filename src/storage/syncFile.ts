import { z } from 'zod';
import { CardsDocSchema, emptyCards, FlagsDocSchema, MAX_DOC_VERSION, ProgressDocSchema, type CardsDoc, type FlagsDoc, type ProgressDoc } from './docs';

// The one file format for moving data between devices AND for backups (D1).
//   format 1 = the v1.4 backup:   { kind: 'studyapp-backup', createdAt, progress, flags }
//   format 2 = the v1.5 sync file: { kind: 'studyapp-sync', formatVersion: 2, appVersion, device, createdAt, progress, flags }
//   format 3 = + cards (flashcard progress, v2.0)
// Older formats are upgraded on import, one step at a time (1 → 2 → 3), so each
// new format only adds one upgrade function. The docs inside are upgraded by their
// own schemas (flags v1 → v2, attempt ids, stamps, tombstones).
// This lives in storage, not in @study/pack: it's app data, not pack format.

export const SYNC_FORMAT = 3;

/** The v1.4 backup file, exactly as v1.4.1 wrote and read it. */
export const LegacyBackupSchema = z.object({
  kind: z.literal('studyapp-backup'),
  createdAt: z.string(),
  progress: ProgressDocSchema,
  flags: FlagsDocSchema,
});

/** The v1.5 sync file (format 2). */
export const SyncFileV2Schema = z.object({
  kind: z.literal('studyapp-sync'),
  formatVersion: z.literal(2),
  appVersion: z.string(),
  device: z.string(),
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
  cards: CardsDocSchema,
});
export type SyncFile = z.infer<typeof SyncFileSchema>;

export function makeSyncFile(progress: ProgressDoc, flags: FlagsDoc, opts: { device: string; cards?: CardsDoc; appVersion?: string; now?: Date }): SyncFile {
  return {
    kind: 'studyapp-sync',
    formatVersion: SYNC_FORMAT,
    appVersion: opts.appVersion ?? __APP_VERSION__,
    device: opts.device,
    createdAt: (opts.now ?? new Date()).toISOString(),
    progress,
    flags,
    cards: opts.cards ?? emptyCards(),
  };
}

/** Format 1 → 2. */
export function upgradeV1Backup(b: z.infer<typeof LegacyBackupSchema>): z.infer<typeof SyncFileV2Schema> {
  return { kind: 'studyapp-sync', formatVersion: 2, appVersion: '1.4', device: '', createdAt: b.createdAt, progress: b.progress, flags: b.flags };
}

/** Format 2 → 3: no flashcard progress yet. */
export function upgradeV2(f: z.infer<typeof SyncFileV2Schema>): SyncFile {
  return { ...f, formatVersion: SYNC_FORMAT, cards: emptyCards() };
}

export type ParsedSyncFile = { ok: true; file: SyncFile; upgradedFrom: number | null } | { ok: false; error: string; newerVersion?: boolean };

const NEWER = 'This file was made by a newer version of the app. Update the app (reload the page) and try again.';
const DAMAGED = 'This file is not a Study app sync file or backup, or it is damaged.';

export function parseSyncFile(text: string): ParsedSyncFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This file is not a sync file or backup (it is not valid JSON).' };
  }
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const ours = o.kind === 'studyapp-sync' || o.kind === 'studyapp-backup';
  const docVersion = (d: unknown) => (d && typeof d === 'object' ? (d as { schemaVersion?: unknown }).schemaVersion : undefined);
  const newerDoc = (['progress', 'flags', 'cards'] as const).some((k) => {
    const v = docVersion(o[k]);
    return typeof v === 'number' && v > MAX_DOC_VERSION[k];
  });
  if (o.kind === 'studyapp-sync' && typeof o.formatVersion === 'number' && o.formatVersion > SYNC_FORMAT) return { ok: false, error: NEWER, newerVersion: true };
  if (ours && newerDoc) return { ok: false, error: NEWER, newerVersion: true };

  if (o.kind === 'studyapp-backup') {
    const r = LegacyBackupSchema.safeParse(raw);
    return r.success ? { ok: true, file: upgradeV2(upgradeV1Backup(r.data)), upgradedFrom: 1 } : { ok: false, error: DAMAGED };
  }
  if (o.kind === 'studyapp-sync' && o.formatVersion === 2) {
    const r = SyncFileV2Schema.safeParse(raw);
    return r.success ? { ok: true, file: upgradeV2(r.data), upgradedFrom: 2 } : { ok: false, error: DAMAGED };
  }
  const r = SyncFileSchema.safeParse(raw);
  return r.success ? { ok: true, file: r.data, upgradedFrom: null } : { ok: false, error: DAMAGED };
}

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

/** Answer, flag and card-review counts, for the Replace confirmation. */
export const fileCounts = (b: Pick<SyncFile, 'progress' | 'flags'> & { cards?: CardsDoc }) => ({
  attempts: b.progress.attempts.length,
  flags: b.flags.flags.length,
  reviews: b.cards?.reviews.length ?? 0,
});

export const MAX_LABEL = 30;
export const cleanLabel = (s: string): string => s.trim().replace(/\s+/g, ' ').slice(0, MAX_LABEL).trim();
