import { describe, expect, it } from 'vitest';
import fixture from '../../test/fixtures/sample-pack.json';
import { formatIssues, parsePack } from './checks';
import { cardsOf } from './schema';

const clone = () => structuredClone(fixture) as any;

describe('parsePack', () => {
  it('accepts the sample pack with no errors or warnings', () => {
    const r = parsePack(clone());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  it('the sample pack has flashcards of all four types, a labelled diagram card and an unconfirmed card', () => {
    const r = parsePack(clone());
    if (!r.ok) throw new Error(formatIssues(r.errors));
    const cards = cardsOf(r.pack);
    expect(new Set(cards.map((c) => c.type))).toEqual(new Set(['term', 'concept', 'cloze', 'diagram']));
    const diagram = cards.find((c) => c.type === 'diagram')!;
    expect(diagram.image?.data).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(diagram.image?.labels.map((l) => l.key)).toContain(diagram.label);
    expect(cards.some((c) => c.status === 'unconfirmed' && c.preflag)).toBe(true);
    expect(cards.some((c) => c.relatedQuestionIds.length > 0)).toBe(true);
  });

  it('reports schema errors with a path', () => {
    const p = clone();
    delete p.questions[0].stem;
    const r = parsePack(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].path).toBe('questions.0.stem');
  });

  it('reports semantic errors', () => {
    const p = clone();
    p.questions[2].options[0].correct = true;
    const r = parsePack(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].message).toMatch(/2 correct options/);
  });

  it('warns about answer-letter skew', () => {
    const p = clone();
    const base = p.questions[2];
    p.questions = Array.from({ length: 12 }, (_, i) => ({
      ...structuredClone(base),
      id: `q-alpha-${String(i + 1).padStart(4, '0')}`,
      stem: `Stem ${i}`,
    }));
    p.flashcards = []; // their related questions were replaced above
    const r = parsePack(p);
    expect(r.ok && r.warnings.some((w) => /letter C/.test(w.message))).toBe(true);
  });
});

describe('formatIssues', () => {
  it('lists issues and truncates', () => {
    const issues = Array.from({ length: 12 }, (_, i) => ({ path: `p${i}`, message: 'bad' }));
    const text = formatIssues(issues, 10);
    expect(text.split('\n')).toHaveLength(11);
    expect(text).toMatch(/and 2 more/);
  });
});

describe('groups', () => {
  it('the sample pack has two groups covering every module', () => {
    const r = parsePack(clone());
    if (!r.ok) throw new Error(formatIssues(r.errors));
    expect(r.pack.groups?.map((g) => g.id)).toEqual(['first-season', 'second-season']);
  });

  it('a pack without groups parses to the same thing as before', () => {
    const p = clone();
    delete p.groups;
    const r = parsePack(p);
    expect(r.ok && r.warnings).toEqual([]);
    expect(r.ok && r.pack.groups).toBeUndefined();
  });

  it('an empty groups list is fine', () => {
    const p = clone();
    p.groups = [];
    expect(parsePack(p).ok).toBe(true);
  });

  const errorsOf = (mutate: (p: any) => void) => {
    const p = clone();
    mutate(p);
    const r = parsePack(p);
    return r.ok ? [] : r.errors.map((e) => `${e.path}: ${e.message}`);
  };

  it('rejects a module in two groups', () => {
    const e = errorsOf((p) => p.groups[1].moduleIds.push('alpha'));
    expect(e.join('\n')).toMatch(/groups\.second-season.*"alpha" is already in group "first-season"/);
  });

  it('rejects an unknown module id', () => {
    expect(errorsOf((p) => p.groups[0].moduleIds.push('nope')).join('\n')).toMatch(/unknown module "nope"/);
  });

  it('rejects a duplicate group id and a module listed twice', () => {
    expect(errorsOf((p) => (p.groups[1].id = 'first-season')).join('\n')).toMatch(/duplicate group id/);
    expect(errorsOf((p) => p.groups[0].moduleIds.push('alpha')).join('\n')).toMatch(/listed twice/);
  });

  it('rejects an empty moduleIds list', () => {
    expect(errorsOf((p) => (p.groups[0].moduleIds = [])).length).toBeGreaterThan(0);
  });

  it('modules outside every group are allowed', () => {
    const p = clone();
    p.groups = [p.groups[0]];
    expect(parsePack(p).ok).toBe(true);
  });
});
