import { describe, expect, it } from 'vitest';
import { makePack } from '../../test/makePack';
import { assembleMock } from './mock';
import { indexPack } from './packIndex';
import { mulberry32 } from './rng';

const ix = indexPack(makePack({ alpha: 90, beta: 35, gamma: 80 }, { groups: 4, groupSize: 3 }));
const bp = ix.pack.examBlueprint;

describe('assembleMock', () => {
  it('meets the blueprint for 200 seeds', () => {
    for (let seed = 0; seed < 200; seed++) {
      const { questions, warnings } = assembleMock(ix, bp, mulberry32(seed));
      const ids = questions.map((q) => q.id);
      expect(warnings).toEqual([]);
      expect(questions).toHaveLength(33);
      expect(new Set(ids).size).toBe(33);
      for (const m of ['alpha', 'beta', 'gamma']) {
        expect(questions.filter((q) => ix.moduleOf(q) === m).length).toBeGreaterThanOrEqual(5);
      }
      // Scenario sets: contiguous, complete, and in pack order.
      const bySc = new Map<string, number[]>();
      questions.forEach((q, i) => q.scenarioId && bySc.set(q.scenarioId, [...(bySc.get(q.scenarioId) ?? []), i]));
      for (const [sc, idx] of bySc) {
        expect(idx).toHaveLength(3);
        expect(idx[2] - idx[0]).toBe(2);
        const members = idx.map((i) => questions[i].id);
        expect(members).toEqual([...members].sort());
        expect(sc).toMatch(/^sc-/);
      }
    }
  });

  it('never touches answer options', () => {
    const { questions } = assembleMock(ix, bp, mulberry32(1));
    for (const q of questions) expect(q).toBe(ix.question.get(q.id));
    for (const q of questions) expect(q.options.map((o) => o.key)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('is deterministic for a seed', () => {
    const a = assembleMock(ix, bp, mulberry32(42)).questions.map((q) => q.id);
    const b = assembleMock(ix, bp, mulberry32(42)).questions.map((q) => q.id);
    expect(a).toEqual(b);
  });

  it('returns everything with a warning when the pool is too small', () => {
    const small = indexPack(makePack({ alpha: 10, beta: 6, gamma: 4 }));
    const { questions, warnings } = assembleMock(small, bp, mulberry32(3));
    expect(questions).toHaveLength(20);
    expect(warnings.join(' ')).toMatch(/Only 4 GAMMA questions/);
    expect(warnings.join(' ')).toMatch(/Only 20 questions available/);
  });

  it('handles a pack with only one module', () => {
    const one = indexPack(makePack({ alpha: 40 }));
    const { questions, warnings } = assembleMock(one, bp, mulberry32(5));
    expect(questions).toHaveLength(33);
    expect(warnings).toEqual([]);
  });

  it('skips excluded questions', () => {
    const exclude = new Set(ix.pack.questions.slice(0, 100).map((q) => q.id));
    const { questions } = assembleMock(ix, bp, mulberry32(9), exclude);
    expect(questions.some((q) => exclude.has(q.id))).toBe(false);
  });
});

describe('assembleMock with unconfirmed questions', () => {
  it('never includes unconfirmed questions', () => {
    const pack = makePack({ alpha: 40, beta: 20, gamma: 30 });
    const unconfirmedIds = new Set(pack.questions.filter((_, i) => i % 3 === 0).map((q) => q.id));
    for (const q of pack.questions) {
      if (unconfirmedIds.has(q.id)) Object.assign(q, { status: 'unconfirmed', preflag: { reason: 'unclear', note: 'n' } });
    }
    const ix2 = indexPack(pack);
    for (let seed = 0; seed < 50; seed++) {
      const { questions } = assembleMock(ix2, pack.examBlueprint, mulberry32(seed));
      expect(questions).toHaveLength(33);
      expect(questions.some((q) => unconfirmedIds.has(q.id))).toBe(false);
    }
  });
});
