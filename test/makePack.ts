import type { Pack, Question } from '../src/pack/schema';
import type { Attempt } from '../src/storage/docs';

/**
 * Synthetic pack for tests: `perModule` questions in each module, one topic
 * per module (`<module>-t`), optional scenario sets of size `groupSize`
 * (the first `groups` × `groupSize` questions of each module).
 */
export function makePack(
  perModule: Record<string, number>,
  opts: { groups?: number; groupSize?: number; questionCount?: number; moduleGroups?: Pack['groups']; sections?: NonNullable<Pack['examBlueprint']['sections']> } = {},
): Pack {
  const { groups = 0, groupSize = 3, questionCount = 33, moduleGroups, sections } = opts;
  const questions: Question[] = [];
  const scenarios: Pack['scenarios'] = [];
  for (const [m, n] of Object.entries(perModule)) {
    for (let i = 0; i < n; i++) {
      const g = Math.floor(i / groupSize);
      const scenarioId = g < groups ? `sc-${m}-${g}` : null;
      if (scenarioId && i % groupSize === 0) scenarios.push({ id: scenarioId, text: `Scenario ${m} ${g}`, figure: null });
      questions.push(makeQuestion(`q-${m}-${String(i + 1).padStart(4, '0')}`, `${m}-t`, scenarioId, i % 4));
    }
  }
  return {
    packId: 'test-pack',
    version: 1,
    title: 'Test pack',
    examDate: '2026-11-18',
    examBlueprint: { questionCount, timeLimitMinutes: 50, minModuleShare: sections ? 0 : 0.15, ...(sections ? { sections } : {}) },
    modules: Object.keys(perModule).map((m) => ({ id: m, name: m.toUpperCase(), topics: [{ id: `${m}-t`, name: `${m} topic`, source: '' }] })),
    ...(moduleGroups ? { groups: moduleGroups } : {}),
    scenarios,
    questions,
  };
}

export function makeQuestion(id: string, topicId: string, scenarioId: string | null = null, correctIndex = 0): Question {
  return {
    id,
    topicIds: [topicId],
    scenarioId,
    stem: `Stem of ${id}?`,
    figure: null,
    type: 'single',
    options: ['A', 'B', 'C', 'D'].map((key, i) => ({
      key,
      text: `Option ${key} of ${id}`,
      correct: i === correctIndex,
      explanation: `Why ${key}`,
    })),
    summary: `Summary of ${id}`,
    level: 'recall',
    origin: 'generated',
    sources: [{ file: 'source/sample/x.pdf', locator: 'slide 1' }],
    status: 'verified',
  };
}

let clock = 0;
export function attempt(questionId: string, correct: boolean, sessionId = 's1'): Attempt {
  clock++;
  return {
    id: `att-${clock}`,
    questionId,
    packId: 'test-pack',
    sessionId,
    mode: 'drill',
    chosen: [correct ? 'A' : 'B'],
    correct,
    at: new Date(Date.UTC(2026, 10, 1, 0, 0, clock)).toISOString(),
    ms: 1000,
  };
}
