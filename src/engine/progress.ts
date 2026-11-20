import type { Attempt, ProgressDoc, Session } from '../storage/docs';
import type { PackIndex } from './packIndex';
import { pct, type Score } from './scoring';

/** Per-topic accuracy uses only the most recent attempts (mockup: "last 20 attempts per topic"). */
export const TOPIC_WINDOW = 20;

/** Latest attempt for each question (attempts are stored oldest first). */
export function latestByQuestion(attempts: readonly Attempt[]): Map<string, Attempt> {
  const m = new Map<string, Attempt>();
  for (const a of attempts) m.set(a.questionId, a);
  return m;
}

/** Questions whose most recent attempt was wrong. */
export function missedIds(attempts: readonly Attempt[]): Set<string> {
  const out = new Set<string>();
  for (const [id, a] of latestByQuestion(attempts)) if (!a.correct) out.add(id);
  return out;
}

export interface TopicStat extends Score {
  topicId: string;
  name: string;
  moduleId: string;
  moduleName: string;
  pct: number;
}

/** Accuracy per topic over its last TOPIC_WINDOW attempts, weakest first; unattempted topics last. */
export function topicStats(ix: PackIndex, attempts: readonly Attempt[], window = TOPIC_WINDOW): TopicStat[] {
  const perTopic = new Map<string, Attempt[]>();
  for (const a of attempts) {
    const q = ix.question.get(a.questionId);
    if (!q) continue;
    for (const t of q.topicIds) {
      let list = perTopic.get(t);
      if (!list) perTopic.set(t, (list = []));
      list.push(a);
    }
  }
  const stats: TopicStat[] = [];
  for (const [id, t] of ix.topic) {
    const recent = (perTopic.get(id) ?? []).slice(-window);
    const s = { correct: recent.filter((a) => a.correct).length, total: recent.length };
    stats.push({ topicId: id, name: t.name, moduleId: t.moduleId, moduleName: ix.module.get(t.moduleId)?.name ?? '', ...s, pct: pct(s) });
  }
  return stats.sort((a, b) => {
    if (!a.total !== !b.total) return a.total ? -1 : 1;
    return a.pct - b.pct || b.total - a.total;
  });
}

export interface ModuleStat extends Score {
  moduleId: string;
  name: string;
  seen: number;
  available: number;
  pct: number;
}

/** Accuracy per module over the latest attempt of each seen question. */
export function moduleStats(ix: PackIndex, attempts: readonly Attempt[]): ModuleStat[] {
  const latest = latestByQuestion(attempts);
  return ix.pack.modules.map((m) => {
    const qs = ix.pack.questions.filter((q) => ix.moduleOf(q) === m.id);
    const seen = qs.map((q) => latest.get(q.id)).filter((a): a is Attempt => !!a);
    const s = { correct: seen.filter((a) => a.correct).length, total: seen.length };
    return { moduleId: m.id, name: m.name, seen: seen.length, available: qs.length, ...s, pct: pct(s) };
  });
}

/** Overall accuracy over the latest attempt of each seen question in the pack. */
export function overallStats(ix: PackIndex, attempts: readonly Attempt[]): Score & { pct: number; seen: number } {
  const latest = [...latestByQuestion(attempts).values()].filter((a) => ix.question.has(a.questionId));
  const s = { correct: latest.filter((a) => a.correct).length, total: latest.length };
  return { ...s, pct: pct(s), seen: latest.length };
}

export function sessionScore(session: Session, attempts: readonly Attempt[]): Score {
  const mine = attempts.filter((a) => a.sessionId === session.id);
  return { correct: mine.filter((a) => a.correct).length, total: mine.length };
}

/** Newest first; sessions with no attempts are left out. */
export function recentSessions(progress: ProgressDoc, n = 5): { session: Session; score: Score }[] {
  return [...progress.sessions]
    .reverse()
    .map((session) => ({ session, score: sessionScore(session, progress.attempts) }))
    .filter((s) => s.score.total > 0)
    .slice(0, n);
}

/** FR-17: how many topics Home shows before "Show all topics", and how many "Drill weakest" drills. */
export const WEAKEST_SHOWN = 5;
export const WEAKEST_DRILLED = 3;

/**
 * The attempted topics, weakest first (topicStats' order: lowest accuracy, then most
 * answers, then pack order), cut to `n` unless showing all.
 */
export function weakestTopics<T extends { total: number }>(stats: readonly T[], showAll: boolean, n = WEAKEST_SHOWN): T[] {
  const attempted = stats.filter((t) => t.total > 0);
  return showAll ? attempted : attempted.slice(0, n);
}

export interface NodeStat extends Score {
  /** Questions in the node answered at least once. */
  seen: number;
  /** Questions in the node. */
  available: number;
  pct: number;
}

/**
 * Accuracy under any set of topics (a group, a module, one topic): the latest attempt of each
 * seen question, the same rule as moduleStats. A question counts once, even under several topics.
 */
export function nodeStats(ix: PackIndex, attempts: readonly Attempt[], topicIds: Iterable<string>): NodeStat {
  const ids = new Set(topicIds);
  const latest = latestByQuestion(attempts);
  const qs = ix.pack.questions.filter((q) => q.topicIds.some((t) => ids.has(t)));
  const seen = qs.map((q) => latest.get(q.id)).filter((a): a is Attempt => !!a);
  const s = { correct: seen.filter((a) => a.correct).length, total: seen.length };
  return { seen: seen.length, available: qs.length, ...s, pct: pct(s) };
}

/** Study-bank progress: questions with origin "study-bank", and how many of them have been answered at least once. */
export function bankStats(ix: PackIndex, attempts: readonly Attempt[]): { total: number; seen: number } {
  const latest = latestByQuestion(attempts);
  const bank = ix.pack.questions.filter((q) => q.origin === 'study-bank');
  return { total: bank.length, seen: bank.filter((q) => latest.has(q.id)).length };
}

export interface GroupStat extends NodeStat {
  groupId: string;
  name: string;
}

/** Accuracy per module group (empty when the pack has no groups). Same rule as moduleStats. */
export function groupStats(ix: PackIndex, attempts: readonly Attempt[]): GroupStat[] {
  return [...ix.group.values()].map((g) => {
    const topics = g.moduleIds.flatMap((mid) => ix.module.get(mid)?.topics.map((t) => t.id) ?? []);
    return { groupId: g.id, name: g.name, ...nodeStats(ix, attempts, topics) };
  });
}
