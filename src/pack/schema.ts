import { z } from 'zod';

// Content-pack schema (spec §3). One Zod schema gives both the runtime check
// (used by the app on import and by pipeline/validate.ts) and the static
// TypeScript types below via z.infer — no hand-written duplicate interfaces.

export const QUESTION_ID_RE = /^q-[a-z0-9]+(-[a-z0-9]+)*-\d{4}$/;
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const slug = z.string().regex(SLUG_RE, 'must be lowercase-kebab-case');
const nonEmpty = z.string().trim().min(1, 'must not be empty');

export const FigureSchema = z.object({
  file: nonEmpty,
  caption: z.string(),
});

export const TopicSchema = z.object({
  id: slug,
  name: nonEmpty,
  source: z.string(),
});

export const ModuleSchema = z.object({
  id: slug,
  name: nonEmpty,
  topics: z.array(TopicSchema).min(1),
});

export const ScenarioSchema = z.object({
  id: slug,
  text: nonEmpty,
  figure: FigureSchema.nullable(),
});

export const OptionSchema = z.object({
  key: z.string().regex(/^[A-Z]$/, 'must be a single capital letter'),
  text: nonEmpty,
  correct: z.boolean(),
  explanation: nonEmpty,
});

export const SourceSchema = z.object({
  file: nonEmpty,
  locator: nonEmpty,
});

export const FLAG_REASONS = ['answer-wrong', 'explanation-wrong', 'unclear', 'typo', 'other'] as const;

/** A known doubt shipped with the question (status "unconfirmed"), e.g. sources disagree. */
export const PreflagSchema = z.object({
  reason: z.enum(FLAG_REASONS),
  note: nonEmpty,
});

export const QuestionSchema = z
  .object({
    id: z.string().regex(QUESTION_ID_RE, 'must look like q-<prefix>-0001'),
    topicIds: z.array(slug).min(1),
    scenarioId: slug.nullable(),
    stem: nonEmpty,
    figure: FigureSchema.nullable(),
    type: z.enum(['single', 'multi']),
    options: z.array(OptionSchema).min(2).max(6),
    summary: z.string(),
    level: z.enum(['recall', 'application', 'clinical']),
    origin: z.enum(['generated', 'course-practice']),
    sources: z.array(SourceSchema).min(1, 'needs at least one source'),
    status: z.enum(['draft', 'verified', 'flagged-fixed', 'unconfirmed']),
    preflag: PreflagSchema.optional(),
    /** flagged-fixed only: the pack version that made the fix. Flags made on an older version show "Resolved". Set by merge. */
    fixedIn: z.number().int().positive().optional(),
  })
  .superRefine((q, ctx) => {
    if (q.status === 'unconfirmed' && !q.preflag) {
      ctx.addIssue({ code: 'custom', path: ['preflag'], message: 'unconfirmed questions need a preflag {reason, note}' });
    }
    if (q.preflag && q.status !== 'unconfirmed') {
      ctx.addIssue({ code: 'custom', path: ['preflag'], message: 'preflag is only allowed on unconfirmed questions' });
    }
    if (q.fixedIn !== undefined && q.status !== 'flagged-fixed') {
      ctx.addIssue({ code: 'custom', path: ['fixedIn'], message: 'fixedIn is only allowed on flagged-fixed questions' });
    }
    q.options.forEach((o, i) => {
      const expected = String.fromCharCode(65 + i);
      if (o.key !== expected) {
        ctx.addIssue({
          code: 'custom',
          path: ['options', i, 'key'],
          message: `option keys must run A, B, C… in order (expected ${expected}, got ${o.key})`,
        });
      }
    });
  });

// ---- Flashcards (optional in a pack) ---------------------------------------

export const CARD_ID_RE = /^c-[a-z0-9]+(-[a-z0-9]+)*-\d{4}$/;
export const CARD_TYPES = ['term', 'concept', 'cloze', 'diagram'] as const;
/** The one blank a cloze card's front must contain. */
export const CLOZE_BLANK = '____';

/** A labelled point on a card image. x and y are fractions of the width and height (0–1). */
export const CardLabelSchema = z.object({
  key: z.string().regex(/^[A-Z]$/, 'must be a single capital letter'),
  x: z.number().min(0, 'must be between 0 and 1').max(1, 'must be between 0 and 1'),
  y: z.number().min(0, 'must be between 0 and 1').max(1, 'must be between 0 and 1'),
});

/** An image embedded in the card as a data: URI (packs are single self-contained files). */
export const CardImageSchema = z.object({
  data: nonEmpty,
  alt: nonEmpty,
  labels: z.array(CardLabelSchema).default([]),
});

export const FlashcardSchema = z
  .object({
    id: z.string().regex(CARD_ID_RE, 'must look like c-<prefix>-0001'),
    topicIds: z.array(slug).min(1),
    type: z.enum(CARD_TYPES),
    front: nonEmpty,
    back: nonEmpty,
    image: CardImageSchema.nullable().default(null),
    /** Diagram cards: which of image.labels the card asks about. */
    label: z.string().regex(/^[A-Z]$/, 'must be a single capital letter').optional(),
    /** Questions this card helps with ("Review the related cards" after a wrong answer). */
    relatedQuestionIds: z.array(z.string()).default([]),
    sources: z.array(SourceSchema).min(1, 'needs at least one source'),
    status: z.enum(['draft', 'verified', 'unconfirmed']),
    preflag: PreflagSchema.optional(),
  })
  .superRefine((c, ctx) => {
    if (c.status === 'unconfirmed' && !c.preflag) ctx.addIssue({ code: 'custom', path: ['preflag'], message: 'unconfirmed cards need a preflag {reason, note}' });
    if (c.preflag && c.status !== 'unconfirmed') ctx.addIssue({ code: 'custom', path: ['preflag'], message: 'preflag is only allowed on unconfirmed cards' });
    if (c.type === 'cloze') {
      const blanks = c.front.split(CLOZE_BLANK).length - 1;
      if (blanks !== 1) ctx.addIssue({ code: 'custom', path: ['front'], message: `a cloze card needs exactly one ${CLOZE_BLANK} (found ${blanks})` });
    }
    if (c.type === 'diagram') {
      if (!c.image) ctx.addIssue({ code: 'custom', path: ['image'], message: 'a diagram card needs an image' });
      else if (!c.image.labels.length) ctx.addIssue({ code: 'custom', path: ['image', 'labels'], message: 'a diagram card needs at least one label' });
      if (!c.label) ctx.addIssue({ code: 'custom', path: ['label'], message: 'a diagram card needs a label naming the part it asks about' });
      else if (c.image && c.image.labels.length && !c.image.labels.some((l) => l.key === c.label)) {
        ctx.addIssue({ code: 'custom', path: ['label'], message: `label "${c.label}" is not one of the image's labels` });
      }
    } else if (c.label) {
      ctx.addIssue({ code: 'custom', path: ['label'], message: 'only diagram cards have a label' });
    }
  });

export const ExamBlueprintSchema = z.object({
  questionCount: z.number().int().positive(),
  timeLimitMinutes: z.number().int().positive(),
  minModuleShare: z.number().min(0).max(1),
});

export const PackSchema = z.object({
  packId: slug,
  version: z.number().int().min(1),
  title: nonEmpty,
  examDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD').optional(),
  examBlueprint: ExamBlueprintSchema,
  modules: z.array(ModuleSchema).min(1),
  scenarios: z.array(ScenarioSchema),
  questions: z.array(QuestionSchema),
  /** Optional: packs without flashcards still load. Read it with cardsOf(pack). */
  flashcards: z.array(FlashcardSchema).optional(),
});

export type Figure = z.infer<typeof FigureSchema>;
export type Topic = z.infer<typeof TopicSchema>;
export type Module = z.infer<typeof ModuleSchema>;
export type Scenario = z.infer<typeof ScenarioSchema>;
export type Option = z.infer<typeof OptionSchema>;
export type Source = z.infer<typeof SourceSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type ExamBlueprint = z.infer<typeof ExamBlueprintSchema>;
export type Pack = z.infer<typeof PackSchema>;
export type Preflag = z.infer<typeof PreflagSchema>;
export type Flashcard = z.infer<typeof FlashcardSchema>;
export type CardType = (typeof CARD_TYPES)[number];
export type CardImage = z.infer<typeof CardImageSchema>;

/** The pack's flashcards ([] when it has none). */
export const cardsOf = (pack: { flashcards?: Flashcard[] }): Flashcard[] => pack.flashcards ?? [];
