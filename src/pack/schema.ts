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
