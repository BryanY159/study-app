import { z } from 'zod';

// The two persisted documents. They map 1:1 to data/progress.json and
// data/flags.json, so a folder-backed store can be added without changing them.

/** Attempts saved before v1.4 have no id; this one is stable and unique per answer. */
export const legacyAttemptId = (a: { sessionId: string; questionId: string; at: string }): string => `${a.sessionId}|${a.questionId}|${a.at}`;

export const AttemptSchema = z
  .object({
  /** Unique per answer. Attempts are append-only and merged by id. */
  id: z.string().optional(),
  questionId: z.string(),
  packId: z.string(),
  sessionId: z.string(),
  mode: z.enum(['drill', 'mock']),
  /** Option keys chosen; empty when a mock question was left blank. */
  chosen: z.array(z.string()),
  correct: z.boolean(),
  at: z.string(),
  ms: z.number().nonnegative(),
})
  .transform((a) => ({ ...a, id: a.id ?? legacyAttemptId(a) }));

export const SessionSchema = z.object({
  id: z.string(),
  mode: z.enum(['drill', 'mock']),
  packId: z.string(),
  label: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  questionIds: z.array(z.string()),
  /** Mock only: questions marked for review, and the time limit used (null = untimed). */
  marked: z.array(z.string()).default([]),
  timeLimitMinutes: z.number().nullable().default(null),
});

export const ActiveMockSchema = z.object({
  sessionId: z.string(),
  packId: z.string(),
  questionIds: z.array(z.string()),
  answers: z.record(z.string(), z.string().nullable()),
  marked: z.array(z.string()),
  startedAt: z.string(),
  /** null = untimed practice. */
  timeLimitMinutes: z.number().nullable(),
  current: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
});

export const ProgressDocSchema = z.object({
  schemaVersion: z.literal(1),
  /** ISO time of the last change; picks the newer of the folder and browser copies. "" for v1 data. */
  updatedAt: z.string().default(''),
  /** When she last restored a backup: a copy restored earlier only contributes what came after this. */
  restoredAt: z.string().default(''),
  attempts: z.array(AttemptSchema),
  sessions: z.array(SessionSchema),
  activeMock: ActiveMockSchema.nullable(),
  settings: z.object({ hideFlagged: z.boolean(), activePackId: z.string().nullable().default(null) }),
});

import { FLAG_REASONS } from '../pack/schema';

export { FLAG_REASONS };

export const FlagSchema = z.object({
  id: z.string(),
  packId: z.string(),
  packVersion: z.number(),
  questionId: z.string(),
  reason: z.enum(FLAG_REASONS),
  comment: z.string(),
  mode: z.enum(['drill', 'mock', 'review']),
  /** "preflag": seeded from a question shipped as unconfirmed; her comment goes in `comment`. */
  source: z.enum(['user', 'preflag']).default('user'),
  createdAt: z.string(),
  /** Her last change to this flag. "" = never touched by her (seeded, or saved before v1.4). */
  updatedAt: z.string().default(''),
});

/** A removed flag, so merging with an older copy doesn't bring it back. removedAt "" = removed by the app, not by her. */
export const TombstoneSchema = z.object({ id: z.string(), removedAt: z.string() });

export const FlagsDocSchema = z.object({
  schemaVersion: z.literal(1),
  updatedAt: z.string().default(''),
  restoredAt: z.string().default(''),
  flags: z.array(FlagSchema),
  removed: z.array(TombstoneSchema).default([]),
});

export type Attempt = z.infer<typeof AttemptSchema>;
export type Session = z.infer<typeof SessionSchema>;
export type ActiveMock = z.infer<typeof ActiveMockSchema>;
export type ProgressDoc = z.infer<typeof ProgressDocSchema>;
export type FlagReason = (typeof FLAG_REASONS)[number];
export type Flag = z.infer<typeof FlagSchema>;
export type Tombstone = z.infer<typeof TombstoneSchema>;
export type FlagsDoc = z.infer<typeof FlagsDocSchema>;

export const emptyProgress = (): ProgressDoc => ({
  schemaVersion: 1,
  updatedAt: '',
  restoredAt: '',
  attempts: [],
  sessions: [],
  activeMock: null,
  settings: { hideFlagged: false, activePackId: null },
});

export const emptyFlags = (): FlagsDoc => ({ schemaVersion: 1, updatedAt: '', restoredAt: '', flags: [], removed: [] });
