import { z } from 'zod';
import { STORAGE_PREFIX } from './DataStore';
import { emptyFlags, emptyProgress, FlagsDocSchema, ProgressDocSchema, type FlagsDoc, type ProgressDoc } from './docs';

// Single-file backup of everything she has done (FR-9 manual part).

export const BackupSchema = z.object({
  kind: z.literal('studyapp-backup'),
  createdAt: z.string(),
  progress: ProgressDocSchema,
  flags: FlagsDocSchema,
});
export type Backup = z.infer<typeof BackupSchema>;

export function makeBackup(progress: ProgressDoc, flags: FlagsDoc, now = new Date()): Backup {
  return { kind: 'studyapp-backup', createdAt: now.toISOString(), progress, flags };
}

export function parseBackup(text: string): { ok: true; backup: Backup } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This file is not a backup (it is not valid JSON).' };
  }
  const r = BackupSchema.safeParse(raw);
  if (!r.success) return { ok: false, error: 'This file is not a Study app backup, or it is damaged.' };
  return { ok: true, backup: r.data };
}

/** Save a file to the Downloads folder; works from file:// with no server. */
export function downloadFile(name: string, content: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const dateStamp = (d = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** localStorage, or null if the browser blocks it for this page. */
export function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * For the error screens: whatever this browser still holds. A normal (restorable)
 * backup when the saved docs parse, plus every raw studyapp: entry under `raw`.
 */
export function emergencyBackup(storage: Storage | null, now = new Date()): string {
  const raw: Record<string, string> = {};
  try {
    for (let i = 0; storage && i < storage.length; i++) {
      const k = storage.key(i);
      if (k?.startsWith(STORAGE_PREFIX)) raw[k] = storage.getItem(k) ?? '';
    }
  } catch {
    // Storage blocked part-way: keep what was read.
  }
  const parse = <T>(key: string, schema: { safeParse(x: unknown): { success: true; data: T } | { success: false } }): T | null => {
    try {
      const r = schema.safeParse(JSON.parse(raw[key] ?? 'null'));
      return r.success ? r.data : null;
    } catch {
      return null;
    }
  };
  const progress = parse(`${STORAGE_PREFIX}progress`, ProgressDocSchema) ?? emptyProgress();
  const flags = parse(`${STORAGE_PREFIX}flags`, FlagsDocSchema) ?? emptyFlags();
  return JSON.stringify({ ...makeBackup(progress, flags, now), raw }, null, 2);
}

/** Attempt and flag counts, for the restore confirmation. */
export const backupCounts = (b: Pick<Backup, 'progress' | 'flags'>) => ({ attempts: b.progress.attempts.length, flags: b.flags.flags.length });
