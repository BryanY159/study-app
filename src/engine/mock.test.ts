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

describe('assembleMock without sections (v2.0.0 behaviour)', () => {
  it('gives the same mock as v2.0.0 for a fixed seed', () => {
    const expected = ['q-gamma-0032', 'q-alpha-0024', 'q-beta-0015', 'q-gamma-0047', 'q-gamma-0061', 'q-gamma-0077', 'q-alpha-0028', 'q-beta-0023', 'q-alpha-0027', 'q-alpha-0018', 'q-gamma-0021', 'q-alpha-0051', 'q-alpha-0038', 'q-beta-0025', 'q-alpha-0040', 'q-alpha-0058', 'q-beta-0013', 'q-alpha-0071', 'q-alpha-0036', 'q-beta-0021', 'q-gamma-0057', 'q-alpha-0025', 'q-alpha-0010', 'q-alpha-0011', 'q-alpha-0012', 'q-alpha-0061', 'q-alpha-0043', 'q-alpha-0089', 'q-gamma-0018', 'q-gamma-0078', 'q-alpha-0064', 'q-alpha-0078', 'q-alpha-0045'];
    expect(assembleMock(ix, bp, mulberry32(7)).questions.map((q) => q.id)).toEqual(expected);
  });
});

describe('assembleMock with sections', () => {
  // Alpha and beta share a group; some questions form scenario sets of 3; gamma is on its own; delta is in no section.
  const grouped = indexPack(
    makePack(
      { alpha: 40, beta: 35, gamma: 20, delta: 4 },
      {
        groups: 4,
        groupSize: 3,
        questionCount: 30,
        moduleGroups: [{ id: 'g-ab', name: 'Alpha & beta', moduleIds: ['alpha', 'beta'] }],
        sections: [
          { name: 'Alpha & beta', groupIds: ['g-ab'], count: 20 },
          { name: 'Gamma', moduleIds: ['gamma'], count: 10 },
        ],
      },
    ),
  );
  const sbp = grouped.pack.examBlueprint;
  const inModules = (qs: { id: string }[], mods: string[]) => qs.filter((q) => mods.includes(grouped.moduleOf(grouped.question.get(q.id)!)));

  it('draws exactly each section count and never touches a module in no section, for 200 seeds', () => {
    for (let seed = 0; seed < 200; seed++) {
      const { questions, warnings } = assembleMock(grouped, sbp, mulberry32(seed));
      expect(warnings).toEqual([]);
      expect(questions).toHaveLength(30);
      expect(new Set(questions.map((q) => q.id)).size).toBe(30);
      expect(inModules(questions, ['alpha', 'beta'])).toHaveLength(20);
      expect(inModules(questions, ['gamma'])).toHaveLength(10);
      expect(inModules(questions, ['delta'])).toHaveLength(0);
    }
  });

  it('keeps scenario sets whole and contiguous', () => {
    for (let seed = 0; seed < 200; seed++) {
      const { questions } = assembleMock(grouped, sbp, mulberry32(seed));
      const bySc = new Map<string, number[]>();
      questions.forEach((q, i) => q.scenarioId && bySc.set(q.scenarioId, [...(bySc.get(q.scenarioId) ?? []), i]));
      for (const idx of bySc.values()) {
        expect(idx).toHaveLength(3);
        expect(idx[2] - idx[0]).toBe(2);
      }
    }
  });

  it('skips a scenario set that would overshoot the section count', () => {
    // Two scenario sets of 3 and a section of 4: one set fits, the other would overshoot.
    const tiny = indexPack(makePack({ a: 6 }, { groups: 2, groupSize: 3, questionCount: 4, sections: [{ name: 'A', moduleIds: ['a'], count: 4 }] }));
    const { questions, warnings } = assembleMock(tiny, tiny.pack.examBlueprint, mulberry32(1));
    expect(questions).toHaveLength(3);
    expect(warnings.join(' ')).toMatch(/Only 3 A questions available \(the exam blueprint asks for 4\)/);
  });

  it('warns for a short section and leaves the others alone', () => {
    const short = indexPack(
      makePack(
        { alpha: 10, beta: 10, gamma: 3 },
        { questionCount: 14, sections: [{ name: 'First', moduleIds: ['alpha', 'beta'], count: 10 }, { name: 'Last', moduleIds: ['gamma'], count: 4 }] },
      ),
    );
    const { questions, warnings } = assembleMock(short, short.pack.examBlueprint, mulberry32(5));
    expect(questions).toHaveLength(13);
    expect(warnings[0]).toMatch(/Only 3 Last questions available \(the exam blueprint asks for 4\)/);
    expect(warnings[1]).toMatch(/this mock has 13 instead of 14/);
    expect(questions.filter((q) => short.moduleOf(q) !== 'gamma')).toHaveLength(10);
  });

  it('leaves out unconfirmed and excluded questions', () => {
    const p = makePack({ a: 5 }, { questionCount: 3, sections: [{ name: 'A', moduleIds: ['a'], count: 3 }] });
    p.questions[0] = { ...p.questions[0], status: 'unconfirmed', preflag: { reason: 'other', note: 'x' } };
    const ixp = indexPack(p);
    for (let seed = 0; seed < 50; seed++) {
      const got = assembleMock(ixp, p.examBlueprint, mulberry32(seed), new Set([p.questions[1].id])).questions.map((q) => q.id);
      expect(got).not.toContain(p.questions[0].id);
      expect(got).not.toContain(p.questions[1].id);
      expect(got).toHaveLength(3);
    }
  });

  it('is deterministic for a seed', () => {
    const a = assembleMock(grouped, sbp, mulberry32(9)).questions.map((q) => q.id);
    expect(assembleMock(grouped, sbp, mulberry32(9)).questions.map((q) => q.id)).toEqual(a);
  });
});
