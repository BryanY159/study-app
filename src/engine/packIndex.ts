import { groupsOf, type Group, type Module, type Pack, type Question, type Scenario, type Topic } from '../pack/schema';

/** Lookup tables built once per pack. */
export interface PackIndex {
  pack: Pack;
  question: Map<string, Question>;
  scenario: Map<string, Scenario>;
  topic: Map<string, Topic & { moduleId: string }>;
  module: Map<string, Module>;
  /** Module groups (empty map when the pack has none). */
  group: Map<string, Group>;
  /** The group a module is in, if any. */
  groupOf: (moduleId: string) => Group | undefined;
  /** Module of a question = module of its first topic (all its topics share one). */
  moduleOf: (q: Question) => string;
}

export function indexPack(pack: Pack): PackIndex {
  const topic = new Map<string, Topic & { moduleId: string }>();
  const module = new Map<string, Module>();
  for (const m of pack.modules) {
    module.set(m.id, m);
    for (const t of m.topics) topic.set(t.id, { ...t, moduleId: m.id });
  }
  const group = new Map(groupsOf(pack).map((g) => [g.id, g]));
  const groupOfModule = new Map<string, Group>();
  for (const g of group.values()) for (const mid of g.moduleIds) groupOfModule.set(mid, g);
  return {
    pack,
    question: new Map(pack.questions.map((q) => [q.id, q])),
    scenario: new Map(pack.scenarios.map((s) => [s.id, s])),
    topic,
    module,
    group,
    groupOf: (moduleId) => groupOfModule.get(moduleId),
    moduleOf: (q) => topic.get(q.topicIds[0])?.moduleId ?? '',
  };
}

/**
 * Split questions into units: a lone question, or every question sharing a
 * scenario (in pack order). Units are what gets shuffled, so scenario sets stay together.
 */
export function toUnits(questions: readonly Question[]): Question[][] {
  const units: Question[][] = [];
  const groups = new Map<string, Question[]>();
  for (const q of questions) {
    if (q.scenarioId === null) {
      units.push([q]);
      continue;
    }
    let g = groups.get(q.scenarioId);
    if (!g) {
      g = [];
      groups.set(q.scenarioId, g);
      units.push(g);
    }
    g.push(q);
  }
  return units;
}
