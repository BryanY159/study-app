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
  settings: z.object({
    hideFlagged: z.boolean(),
    activePackId: z.string().nullable().default(null),
    /** Flashcards: new cards per day (device-local; FR-13). */
    newCardsPerDay: z.number().int().min(0).max(500).default(20),
  }),
});

import { FLAG_REASONS } from '../pack/schema';

export { FLAG_REASONS };

export const FlagSchema = z.object({
  id: z.string(),
  packId: z.string(),
  packVersion: z.number(),
  /** What is flagged (flags v2). Card flags came with flashcards. */
  itemType: z.enum(['question', 'card']).default('question'),
  /** The flagged item's id: a question id, or a card id when itemType is 'card'. */
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

/**
 * Flags doc. v2 added itemType (card flags). v1 docs are upgraded on read (every v1
 * flag is a question flag). An older app sees v2 as newer and leaves it untouched
 * instead of stripping itemType (newer-version protection).
 */
export const FLAGS_VERSION = 2;
export const FlagsDocSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]).transform(() => FLAGS_VERSION as 2),
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
  settings: { hideFlagged: false, activePackId: null, newCardsPerDay: 20 },
});

export const emptyFlags = (): FlagsDoc => ({ schemaVersion: 2, updatedAt: '', restoredAt: '', flags: [], removed: [] });

// ---- Flashcard progress (FR-13) ------------------------------------------------
// cardKey = packId|cardId. State per card + an append-only review log. An undone
// review leaves a tombstone, so merging with an older copy can't bring it back.

export const cardKey = (packId: string, cardId: string): string => `${packId}|${cardId}`;

export const CardStateSchema = z.object({
  box: z.number().int().min(1).max(5),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lastReviewedAt: z.string(),
  updatedAt: z.string(),
  /** Back to "new" (its first rating was undone). Kept as a state, not deleted, so the undo wins a merge. */
  fresh: z.boolean().optional(),
});

export const CardReviewSchema = z.object({
  id: z.string(),
  cardKey: z.string(),
  rating: z.enum(['again', 'got-it']),
  at: z.string(),
  /** The device label at the time (for her history; not used by merging). */
  device: z.string().default(''),
  /** Cram reviews are logged but never change the schedule. */
  cram: z.boolean().default(false),
});

export const CardsDocSchema = z.object({
  schemaVersion: z.literal(1),
  updatedAt: z.string().default(''),
  restoredAt: z.string().default(''),
  states: z.record(z.string(), CardStateSchema).default({}),
  reviews: z.array(CardReviewSchema).default([]),
  /** Undone reviews (Undo in a card session). */
  undone: z.array(z.object({ id: z.string(), at: z.string() })).default([]),
});

export type CardStateDoc = z.infer<typeof CardStateSchema>;
export type CardReview = z.infer<typeof CardReviewSchema>;
export type CardsDoc = z.infer<typeof CardsDocSchema>;

export const emptyCards = (): CardsDoc => ({ schemaVersion: 1, updatedAt: '', restoredAt: '', states: {}, reviews: [], undone: [] });

/** The highest schemaVersion this app reads for each doc; a higher one is "newer" and left untouched. */
export const MAX_DOC_VERSION = { progress: 1, flags: FLAGS_VERSION, cards: 1 } as const;
