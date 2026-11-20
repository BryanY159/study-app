import type { z } from 'zod';
import { cardsOf, groupsOf, PackSchema, type Pack } from './schema';

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

  // Groups: unique ids, known modules, each module in at most one group.
  const groupIds = new Set<string>();
  const groupOfModule = new Map<string, string>();
  for (const g of groupsOf(pack)) {
    const at = `groups.${g.id}`;
    if (groupIds.has(g.id)) errors.push({ path: at, message: `duplicate group id "${g.id}"` });
    groupIds.add(g.id);
    const seen = new Set<string>();
    for (const mid of g.moduleIds) {
      if (!moduleIds.has(mid)) errors.push({ path: `${at}.moduleIds`, message: `unknown module "${mid}"` });
      if (seen.has(mid)) errors.push({ path: `${at}.moduleIds`, message: `module "${mid}" is listed twice` });
      seen.add(mid);
      const other = groupOfModule.get(mid);
      if (other !== undefined && other !== g.id) errors.push({ path: `${at}.moduleIds`, message: `module "${mid}" is already in group "${other}" (a module can be in at most one group)` });
      else groupOfModule.set(mid, g.id);
    }
  }

  // Exam sections: every id resolves, one of groupIds/moduleIds, each module in one section, counts add up.
  const sections = pack.examBlueprint.sections;
  if (sections) {
    const sectionOfModule = new Map<string, string>();
    sections.forEach((sec, i) => {
      const at = `examBlueprint.sections.${i}`;
      if ([sec.groupIds, sec.moduleIds, sec.origins].filter(Boolean).length !== 1) {
        errors.push({ path: at, message: `section "${sec.name}" must name groupIds, moduleIds or origins (exactly one of the three)` });
      }
      const mods = new Set<string>();
      for (const gid of sec.groupIds ?? []) {
        const g = groupsOf(pack).find((x) => x.id === gid);
        if (!g) errors.push({ path: `${at}.groupIds`, message: `unknown group "${gid}"` });
        else g.moduleIds.forEach((m) => mods.add(m));
      }
      for (const mid of sec.moduleIds ?? []) {
        if (!moduleIds.has(mid)) errors.push({ path: `${at}.moduleIds`, message: `unknown module "${mid}"` });
        else mods.add(mid);
      }
      for (const mid of mods) {
        const other = sectionOfModule.get(mid);
        if (other !== undefined && other !== sec.name) errors.push({ path: at, message: `module "${mid}" is in sections "${other}" and "${sec.name}" (a module can be in at most one section)` });
        else sectionOfModule.set(mid, sec.name);
      }
    });
    const total = sections.reduce((n, sec) => n + sec.count, 0);
    if (total !== pack.examBlueprint.questionCount) {
      errors.push({ path: 'examBlueprint.sections', message: `section counts add up to ${total}, but questionCount is ${pack.examBlueprint.questionCount}` });
    }
    // Questions an origin section claims never reach a module section, so they don't need one.
    const claimed = new Set(sections.flatMap((sec) => sec.origins ?? []));
    const moduleOfQuestion = (q: { topicIds: string[] }) => topicModule.get(q.topicIds[0]);
    const left = pack.modules.filter((m) => !sectionOfModule.has(m.id) && pack.questions.some((q) => !claimed.has(q.origin) && moduleOfQuestion(q) === m.id));
    if (left.length) warnings.push({ path: 'examBlueprint.sections', message: `a mock never includes these modules (in no section): ${left.map((m) => m.id).join(', ')}` });
    if (pack.examBlueprint.minModuleShare > 0) {
      warnings.push({ path: 'examBlueprint.minModuleShare', message: 'minModuleShare is ignored when sections are set' });
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
