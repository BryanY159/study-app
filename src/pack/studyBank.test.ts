import { describe, expect, it } from 'vitest';
import fixture from '../../test/fixtures/sample-pack.json';
import { parsePack } from './checks';
import { FLAG_REASONS } from './schema';

const clone = () => structuredClone(fixture) as any;
const messages = (r: ReturnType<typeof parsePack>) => (r.ok ? '' : r.errors.map((e) => `${e.path}: ${e.message}`).join('\n'));

describe('five options (v2.3)', () => {
  it('accepts a single-answer question with options A–E', () => {
    const r = parsePack(clone());
    if (!r.ok) throw new Error(messages(r));
    const q = r.pack.questions.find((x) => x.id === 'q-alpha-0006')!;
    expect(q.type).toBe('single');
    expect(q.options.map((o) => o.key)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('still needs the keys to run in order and exactly one correct option', () => {
    const p = clone();
    p.questions.find((x: any) => x.id === 'q-alpha-0006').options[4].key = 'F';
    expect(messages(parsePack(p))).toMatch(/expected E, got F/);
    const p2 = clone();
    p2.questions.find((x: any) => x.id === 'q-alpha-0006').options[4].correct = true;
    expect(messages(parsePack(p2))).toMatch(/2 correct options/);
  });
});

describe('study-bank origin and note', () => {
  it('accepts origin "study-bank" and an optional note', () => {
    const r = parsePack(clone());
    if (!r.ok) throw new Error(messages(r));
    const bank = r.pack.questions.filter((q) => q.origin === 'study-bank');
    expect(bank.map((q) => q.id)).toEqual(['q-bank-0001', 'q-bank-0002']);
    expect(bank[0].note).toMatch(/Not found in lecture sources/);
    expect(bank[1].note).toBeUndefined();
  });

  it('rejects an unknown origin and an empty note', () => {
    const p = clone();
    p.questions[0].origin = 'made-up';
    expect(messages(parsePack(p))).toMatch(/questions\.0\.origin/);
    const p2 = clone();
    p2.questions[0].note = '  ';
    expect(messages(parsePack(p2))).toMatch(/questions\.0\.note/);
  });
});

describe('sections by origin', () => {
  it('the sample pack has an origin section next to its group and module sections', () => {
    const r = parsePack(clone());
    if (!r.ok) throw new Error(messages(r));
    expect(r.pack.examBlueprint.sections).toContainEqual({ name: 'Study bank', origins: ['study-bank'], count: 2 });
  });

  it('a section names exactly one of groupIds, moduleIds or origins', () => {
    const both = clone();
    both.examBlueprint.sections[2].moduleIds = ['gamma'];
    expect(messages(parsePack(both))).toMatch(/exactly one of the three/);
    const none = clone();
    delete none.examBlueprint.sections[2].origins;
    expect(messages(parsePack(none))).toMatch(/exactly one of the three/);
  });

  it('rejects an unknown origin in a section', () => {
    const p = clone();
    p.examBlueprint.sections[2].origins = ['nope'];
    expect(messages(parsePack(p))).toMatch(/sections\.2\.origins/);
  });

  it('counts still have to add up to questionCount', () => {
    const p = clone();
    p.examBlueprint.sections[2].count = 3;
    expect(messages(parsePack(p))).toMatch(/add up to 9, but questionCount is 8/);
  });

  it('does not warn about a module whose only unsectioned questions are claimed by an origin section', () => {
    const p = clone();
    // Drop "Ember moss" from the sections; gamma now has questions no module section covers.
    p.examBlueprint.sections.splice(1, 1);
    p.examBlueprint.questionCount = 5;
    const r = parsePack(p);
    if (!r.ok) throw new Error(messages(r));
    expect(r.warnings.map((w) => w.message).join()).toMatch(/gamma/);
    // Same pack with the gamma questions moved to the bank: no warning about gamma any more.
    for (const q of p.questions) if (q.id.startsWith('q-gamma')) q.origin = 'study-bank';
    const r2 = parsePack(p);
    if (!r2.ok) throw new Error(messages(r2));
    expect(r2.warnings.map((w) => w.message).join()).not.toMatch(/gamma/);
  });
});

describe('office-hours flag reason', () => {
  it('is a valid reason', () => {
    expect(FLAG_REASONS).toContain('office-hours');
  });
});
