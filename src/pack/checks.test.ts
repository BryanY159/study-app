import { describe, expect, it } from 'vitest';
import fixture from '../../test/fixtures/sample-pack.json';
import { formatIssues, parsePack } from './checks';

const clone = () => structuredClone(fixture) as any;

describe('parsePack', () => {
  it('accepts the sample pack with no errors or warnings', () => {
    const r = parsePack(clone());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
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
