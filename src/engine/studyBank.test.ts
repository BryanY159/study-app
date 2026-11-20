import { describe, expect, it } from 'vitest';
import { attempt, makePack } from '../../test/makePack';
import type { Flag } from '../storage/docs';
import { filterFlagsByReason, flagsToJson, flagsToMarkdown, REASON_LABEL } from './flags';
import { assembleMock } from './mock';
import { indexPack } from './packIndex';
import { bankStats } from './progress';
import { mulberry32 } from './rng';
import { scoreSections, sectionIndexOf } from './sections';
import { drillPool } from './select';

// Alpha and beta (4 each) form one module section; three alpha/beta questions come from the study bank.
const BANK = ['q-alpha-0001', 'q-alpha-0002', 'q-beta-0001'];
function bankPack() {
  const pack = makePack(
    { alpha: 4, beta: 4, gamma: 2 },
    { questionCount: 6, sections: [{ name: 'Modules', moduleIds: ['alpha', 'beta'], count: 4 }, { name: 'Study bank', origins: ['study-bank'], count: 2 }] },
  );
  for (const q of pack.questions) if (BANK.includes(q.id)) q.origin = 'study-bank';
  return pack;
}
const pack = bankPack();
const ix = indexPack(pack);
const sections = pack.examBlueprint.sections!;

describe('sections by origin', () => {
  it('a bank question counts toward the origin section only, even when its module is in another section', () => {
    expect(sectionIndexOf(ix, sections, ix.question.get('q-alpha-0001')!)).toBe(1);
    expect(sectionIndexOf(ix, sections, ix.question.get('q-alpha-0003')!)).toBe(0);
    expect(sectionIndexOf(ix, sections, ix.question.get('q-gamma-0001')!)).toBe(-1); // in no section
  });

  it('wins regardless of the order of the sections', () => {
    const reversed = [sections[1], sections[0]];
    expect(sectionIndexOf(ix, reversed, ix.question.get('q-beta-0001')!)).toBe(0);
    expect(sectionIndexOf(ix, reversed, ix.question.get('q-beta-0002')!)).toBe(1);
  });

  it('the mock draws bank questions for the origin section and never for the module section', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const { questions, warnings } = assembleMock(ix, pack.examBlueprint, mulberry32(seed));
      const ids = questions.map((q) => q.id);
      expect(warnings).toEqual([]);
      expect(new Set(ids).size).toBe(6);
      expect(questions.filter((q) => q.origin === 'study-bank')).toHaveLength(2);
      expect(questions.filter((q) => q.origin !== 'study-bank')).toHaveLength(4);
      expect(ids.some((id) => id.startsWith('q-gamma'))).toBe(false);
    }
  });

  it('a short origin section warns and the mock is shorter', () => {
    const thin = bankPack();
    for (const q of thin.questions) if (q.id !== 'q-alpha-0001') q.origin = 'generated';
    const { questions, warnings } = assembleMock(indexPack(thin), thin.examBlueprint, mulberry32(3));
    expect(questions).toHaveLength(5);
    expect(warnings[0]).toMatch(/Only 1 Study bank question available/);
  });

  it('scores each question in one section only', () => {
    const results = [{ questionId: 'q-alpha-0001', correct: true }, { questionId: 'q-alpha-0003', correct: false }, { questionId: 'q-beta-0001', correct: true }];
    expect(scoreSections(ix, sections, results)).toEqual([
      { name: 'Modules', correct: 0, total: 1 },
      { name: 'Study bank', correct: 2, total: 2 },
    ]);
  });
});

describe('study bank drill filter and progress', () => {
  const all = new Set(ix.topic.keys());
  it('"bank" keeps only study-bank questions', () => {
    const pool = drillPool(ix, [], { topicIds: all, filter: 'bank', count: 'all' });
    expect(pool.map((q) => q.id)).toEqual(BANK);
  });

  it('still respects the selected topics and the hidden-flagged list', () => {
    expect(drillPool(ix, [], { topicIds: new Set(['beta-t']), filter: 'bank', count: 'all' }).map((q) => q.id)).toEqual(['q-beta-0001']);
    expect(drillPool(ix, [], { topicIds: all, filter: 'bank', count: 'all', excludeIds: new Set(['q-alpha-0001']) }).map((q) => q.id)).toEqual(['q-alpha-0002', 'q-beta-0001']);
  });

  it('bankStats counts bank questions worked through (answered at least once)', () => {
    expect(bankStats(ix, [])).toEqual({ total: 3, seen: 0 });
    const attempts = [attempt('q-alpha-0001', true), attempt('q-alpha-0001', false), attempt('q-beta-0001', false), attempt('q-alpha-0003', true)];
    expect(bankStats(ix, attempts)).toEqual({ total: 3, seen: 2 }); // the non-bank answer doesn't count
  });

  it('a pack with no bank questions has total 0', () => {
    expect(bankStats(indexPack(makePack({ a: 2 })), [])).toEqual({ total: 0, seen: 0 });
  });
});

describe('"Ask at office hours" flag reason', () => {
  const base: Flag = {
    id: 'f', packId: 'test-pack', packVersion: 1, itemType: 'question', questionId: 'q-alpha-0001', reason: 'answer-wrong',
    comment: '', mode: 'drill', source: 'user', createdAt: '2026-11-05T10:00:00.000Z', updatedAt: '',
  };
  const flags: Flag[] = [
    { ...base, id: 'f1' },
    { ...base, id: 'f2', questionId: 'q-alpha-0002', reason: 'office-hours', comment: 'Why not C?' },
    { ...base, id: 'f3', questionId: 'q-beta-0001', reason: 'office-hours' },
  ];

  it('has a label', () => {
    expect(REASON_LABEL['office-hours']).toBe('Ask at office hours');
  });

  it('filterFlagsByReason keeps only that reason, or everything without one', () => {
    expect(filterFlagsByReason(flags, 'office-hours').map((f) => f.id)).toEqual(['f2', 'f3']);
    expect(filterFlagsByReason(flags).map((f) => f.id)).toEqual(['f1', 'f2', 'f3']);
    expect(filterFlagsByReason(flags, 'typo')).toEqual([]);
  });

  it('the exports of the filtered list hold only those flags', () => {
    const only = filterFlagsByReason(flags, 'office-hours');
    const json = JSON.parse(flagsToJson(only, [pack]));
    expect(json.flags.map((f: { id: string }) => f.id)).toEqual(['f2', 'f3']);
    const md = flagsToMarkdown(only, [pack]);
    expect(md).toContain('q-alpha-0002 — Ask at office hours');
    expect(md).not.toContain('Answer wrong');
  });
});
