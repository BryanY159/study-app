import { describe, expect, it } from 'vitest';
import { makePack } from '../../test/makePack';
import { indexPack } from './packIndex';
import { scoreSections, sectionModuleIds, sectionTopicIds, weakestSectionIndex } from './sections';

const pack = makePack(
  { alpha: 4, beta: 4, gamma: 4, delta: 2 },
  {
    questionCount: 12,
    moduleGroups: [{ id: 'g-ab', name: 'Alpha & beta', moduleIds: ['alpha', 'beta'] }],
    sections: [
      { name: 'Alpha & beta', groupIds: ['g-ab'], count: 8 },
      { name: 'Gamma', moduleIds: ['gamma'], count: 4 },
    ],
  },
);
const ix = indexPack(pack);
const sections = pack.examBlueprint.sections!;
const r = (id: string, correct: boolean) => ({ questionId: id, correct });

describe('section modules and topics', () => {
  it('a group section covers its modules; a module section just that one', () => {
    expect(sectionModuleIds(ix, sections[0]).sort()).toEqual(['alpha', 'beta']);
    expect(sectionModuleIds(ix, sections[1])).toEqual(['gamma']);
    expect(sectionTopicIds(ix, sections[0]).sort()).toEqual(['alpha-t', 'beta-t']);
  });
});

describe('scoreSections', () => {
  it('scores each section from its own modules, in blueprint order, ignoring modules in no section', () => {
    const results = [r('q-alpha-0001', true), r('q-alpha-0002', false), r('q-beta-0001', true), r('q-gamma-0001', false), r('q-gamma-0002', false), r('q-delta-0001', true), r('q-nope-0001', true)];
    expect(scoreSections(ix, sections, results)).toEqual([
      { name: 'Alpha & beta', correct: 2, total: 3 },
      { name: 'Gamma', correct: 0, total: 2 },
    ]);
  });

  it('a section with no questions in the mock shows 0 / 0', () => {
    expect(scoreSections(ix, sections, [r('q-alpha-0001', true)])[1]).toEqual({ name: 'Gamma', correct: 0, total: 0 });
  });
});

describe('weakestSectionIndex', () => {
  it('picks the lowest percentage, the first on a tie', () => {
    expect(weakestSectionIndex([{ name: 'a', correct: 7, total: 11 }, { name: 'b', correct: 5, total: 10 }, { name: 'c', correct: 8, total: 10 }])).toBe(1);
    expect(weakestSectionIndex([{ name: 'a', correct: 1, total: 2 }, { name: 'b', correct: 1, total: 4 }, { name: 'c', correct: 1, total: 4 }])).toBe(1);
  });
  it('highlights nothing when there is nothing to compare', () => {
    expect(weakestSectionIndex([{ name: 'a', correct: 3, total: 5 }])).toBe(-1);
    expect(weakestSectionIndex([{ name: 'a', correct: 3, total: 5 }, { name: 'b', correct: 6, total: 10 }])).toBe(-1); // same 60%
    expect(weakestSectionIndex([{ name: 'a', correct: 0, total: 0 }, { name: 'b', correct: 1, total: 5 }])).toBe(-1); // only one has questions
  });
});
