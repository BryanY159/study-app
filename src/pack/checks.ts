import type { z } from 'zod';
import { cardsOf, PackSchema, type Pack } from './schema';

/** A card image may be at most this big once encoded (data: URI length). */
export const MAX_CARD_IMAGE_BYTES = 400 * 1024;
/** Above this, a pack gets a warning (slow to import on a phone). */
export const PACK_WARN_BYTES = 15 * 1024 * 1024;

// Semantic checks the schema can't express (cross-references, answer keys).
// Pure: no filesystem, so the app can run them on pack import too.

export interface Issue {
  path: string;
  message: string;
}

export interface CheckResult {
  errors: Issue[];
  warnings: Issue[];
}

export function checkPack(pack: Pack): CheckResult {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];

  const topicModule = new Map<string, string>();
  const moduleIds = new Set<string>();
  for (const m of pack.modules) {
    if (moduleIds.has(m.id)) errors.push({ path: `modules.${m.id}`, message: `duplicate module id "${m.id}"` });
    moduleIds.add(m.id);
    for (const t of m.topics) {
      if (topicModule.has(t.id)) errors.push({ path: `topics.${t.id}`, message: `duplicate topic id "${t.id}"` });
      topicModule.set(t.id, m.id);
    }
  }

  const scenarioIds = new Set<string>();
  for (const s of pack.scenarios) {
    if (scenarioIds.has(s.id)) errors.push({ path: `scenarios.${s.id}`, message: `duplicate scenario id "${s.id}"` });
    scenarioIds.add(s.id);
  }

  const questionIds = new Set<string>();
  const stems = new Map<string, string>();
  const letterCounts = new Map<string, number>();

  for (const q of pack.questions) {
    const at = `questions.${q.id}`;
    if (questionIds.has(q.id)) errors.push({ path: at, message: `duplicate question id "${q.id}"` });
    questionIds.add(q.id);

    const modules = new Set<string>();
    for (const t of q.topicIds) {
      const m = topicModule.get(t);
      if (!m) errors.push({ path: `${at}.topicIds`, message: `unknown topic "${t}"` });
      else modules.add(m);
    }
    if (modules.size > 1) {
      errors.push({ path: `${at}.topicIds`, message: `topics span several modules (${[...modules].join(', ')})` });
    }

    if (q.scenarioId !== null && !scenarioIds.has(q.scenarioId)) {
      errors.push({ path: `${at}.scenarioId`, message: `unknown scenario "${q.scenarioId}"` });
    }

    const correct = q.options.filter((o) => o.correct);
    if (q.type === 'single' && correct.length !== 1) {
      errors.push({ path: `${at}.options`, message: `single-answer question has ${correct.length} correct options (needs exactly 1)` });
    }
    if (q.type === 'multi' && correct.length < 1) {
      errors.push({ path: `${at}.options`, message: 'multi-answer question has no correct option' });
    }
    if (q.type === 'single' && correct.length === 1) {
      letterCounts.set(correct[0].key, (letterCounts.get(correct[0].key) ?? 0) + 1);
    }

    const norm = normalizeText(q.stem);
    const dup = stems.get(norm);
    if (dup && q.scenarioId === null) warnings.push({ path: at, message: `same stem as ${dup}` });
    else stems.set(norm, q.id);
  }

  // Flashcards: unique ids, topics and related questions resolve, images embedded and small.
  const cardIds = new Set<string>();
  for (const c of cardsOf(pack)) {
    const at = `flashcards.${c.id}`;
    if (cardIds.has(c.id)) errors.push({ path: at, message: `duplicate card id "${c.id}"` });
    cardIds.add(c.id);
    const modules = new Set<string>();
    for (const t of c.topicIds) {
      const m = topicModule.get(t);
      if (!m) errors.push({ path: `${at}.topicIds`, message: `unknown topic "${t}"` });
      else modules.add(m);
    }
    if (modules.size > 1) errors.push({ path: `${at}.topicIds`, message: `topics span several modules (${[...modules].join(', ')})` });
    for (const qid of c.relatedQuestionIds) {
      if (!questionIds.has(qid)) errors.push({ path: `${at}.relatedQuestionIds`, message: `unknown question "${qid}"` });
    }
    if (c.image) {
      if (!/^data:image\/[a-z0-9.+-]+(;[^,]*)?,/i.test(c.image.data)) {
        errors.push({ path: `${at}.image.data`, message: 'the image must be embedded as a data:image/… URI' });
      } else if (c.image.data.length > MAX_CARD_IMAGE_BYTES) {
        errors.push({ path: `${at}.image.data`, message: `the image is ${Math.round(c.image.data.length / 1024)} KB encoded; the limit is ${MAX_CARD_IMAGE_BYTES / 1024} KB` });
      }
    }
  }

  const packBytes = JSON.stringify(pack).length;
  if (packBytes > PACK_WARN_BYTES) {
    warnings.push({ path: '(pack)', message: `the pack is ${(packBytes / 1024 / 1024).toFixed(1)} MB; over ${PACK_WARN_BYTES / 1024 / 1024} MB it may be slow to import on a phone` });
  }

  const singles = [...letterCounts.values()].reduce((a, b) => a + b, 0);
  if (singles >= 10) {
    for (const [letter, n] of letterCounts) {
      if (n / singles > 0.4) {
        warnings.push({ path: 'questions', message: `answer letter ${letter} is correct in ${Math.round((100 * n) / singles)}% of questions` });
      }
    }
  }

  return { errors, warnings };
}

export function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export type ParseResult =
  | { ok: true; pack: Pack; warnings: Issue[] }
  | { ok: false; errors: Issue[] };

/** Schema + semantic checks in one go; used by pack import and the validator. */
export function parsePack(data: unknown): ParseResult {
  const parsed = PackSchema.safeParse(data);
  if (!parsed.success) return { ok: false, errors: zodIssues(parsed.error) };
  const { errors, warnings } = checkPack(parsed.data);
  if (errors.length) return { ok: false, errors };
  return { ok: true, pack: parsed.data, warnings };
}

export function zodIssues(err: z.ZodError): Issue[] {
  return err.issues.map((i) => ({ path: i.path.join('.') || '(root)', message: i.message }));
}

/** Human-readable list for the import error screen. */
export function formatIssues(issues: Issue[], max = 10): string {
  const lines = issues.slice(0, max).map((i) => `• ${i.path}: ${i.message}`);
  if (issues.length > max) lines.push(`…and ${issues.length - max} more`);
  return lines.join('\n');
}
