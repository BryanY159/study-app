// The "export a sync file" reminder on Home. Pure, so tests can move the clock.

/** Remind when the last export from this device is older than this. Set from the iOS storage spike. */
export const REMINDER_DAYS = 3;
const DAY = 86_400_000;

export interface ReminderInput {
  /** Answers saved on this device. Nothing to lose → no reminder. */
  answers: number;
  lastExportAt?: string;
  snoozedUntil?: string;
  now: Date;
  days?: number;
}

/** null = don't show. Otherwise the whole days since the last export (null = never exported here). */
export function reminderDue({ answers, lastExportAt, snoozedUntil, now, days = REMINDER_DAYS }: ReminderInput): { daysSince: number | null } | null {
  if (answers === 0) return null;
  if (snoozedUntil && now.getTime() < Date.parse(snoozedUntil)) return null;
  if (!lastExportAt) return { daysSince: null };
  const since = now.getTime() - Date.parse(lastExportAt);
  return since > days * DAY ? { daysSince: Math.floor(since / DAY) } : null;
}

/** Dismiss = hidden until the same time tomorrow. */
export const snoozeUntil = (now: Date): string => new Date(now.getTime() + DAY).toISOString();
